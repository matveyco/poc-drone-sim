#!/usr/bin/env python3
import asyncio
import json
import time
import os
import numpy as np
import websockets
from collections import deque
import random
import tensorflow as tf
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import Dense
from tensorflow.keras.optimizers import Adam
import matplotlib.pyplot as plt

class DQNAgent:
    """Deep Q-Network agent for drone control using reinforcement learning."""
    
    def __init__(self, state_size, action_size):
        self.state_size = state_size
        self.action_size = action_size
        self.memory = deque(maxlen=10000)  # Experience replay buffer
        self.gamma = 0.95    # Discount factor
        self.epsilon = 1.0   # Exploration rate
        self.epsilon_min = 0.01
        self.epsilon_decay = 0.995
        self.learning_rate = 0.001
        self.update_freq = 10  # How often to update target network
        self.step_counter = 0
        
        # Create main and target networks
        self.model = self._build_model()
        self.target_model = self._build_model()
        self.update_target_model()
    
    def _build_model(self):
        """Build neural network for Q-function approximation."""
        model = Sequential()
        model.add(Dense(64, input_dim=self.state_size, activation='relu'))
        model.add(Dense(64, activation='relu'))
        model.add(Dense(self.action_size, activation='tanh'))  # tanh activation for -1 to 1 output
        model.compile(loss='mse', optimizer=Adam(learning_rate=self.learning_rate))
        return model
    
    def update_target_model(self):
        """Copy weights from main model to target model."""
        self.target_model.set_weights(self.model.get_weights())
        print("Target model updated")
    
    def memorize(self, state, action, reward, next_state, done):
        """Store transition in experience replay memory."""
        self.memory.append((state, action, reward, next_state, done))
    
    def act(self, state):
        """Select action using epsilon-greedy policy."""
        if np.random.rand() <= self.epsilon:
            # Random action in continuous space
            return np.random.uniform(-1, 1, self.action_size)
        
        # Get action from neural network
        act_values = self.model.predict(state, verbose=0)
        return act_values[0]  # Return the action values
    
    def replay(self, batch_size):
        """Train the model using random samples from memory."""
        if len(self.memory) < batch_size:
            return
        
        # Sample random batch from memory
        minibatch = random.sample(self.memory, batch_size)
        
        states = []
        targets = []
        
        for state, action, reward, next_state, done in minibatch:
            # Calculate target Q value
            target = reward
            if not done:
                # Use target network for more stable learning
                next_q_values = self.target_model.predict(next_state, verbose=0)[0]
                target = reward + self.gamma * np.max(next_q_values)
            
            # Current Q values
            target_f = self.model.predict(state, verbose=0)
            
            # Update the Q value for the action taken
            for i in range(self.action_size):
                # For continuous actions, we update proportionally to how close the action was
                similarity = 1 - abs(action[i] - target_f[0][i])
                target_f[0][i] = target_f[0][i] + similarity * (target - target_f[0][i])
            
            states.append(state[0])
            targets.append(target_f[0])
        
        # Train the model
        self.model.fit(np.array(states), np.array(targets), epochs=1, verbose=0)
        
        # Decay epsilon
        if self.epsilon > self.epsilon_min:
            self.epsilon *= self.epsilon_decay
        
        # Update target network periodically
        self.step_counter += 1
        if self.step_counter % self.update_freq == 0:
            self.update_target_model()
    
    def save(self, filepath):
        """Save the model weights."""
        # Create learning directory if it doesn't exist
        os.makedirs("learning", exist_ok=True)
        
        # Ensure filepath is in the learning directory
        if not filepath.startswith("learning/"):
            filepath = f"learning/{filepath}"
        
        # Make sure filepath doesn't already have .weights.h5
        if filepath.endswith('.h5'):
            filepath = filepath[:-3]
        if not filepath.endswith('.weights'):
            filepath += '.weights'
        
        # Save with correct extension
        self.model.save_weights(filepath + '.h5')
        print(f"Model weights saved to {filepath}.h5")
    
    def load(self, filepath):
        """Load the model weights."""
        # Ensure filepath is in the learning directory
        if not filepath.startswith("learning/"):
            filepath = f"learning/{filepath}"
            
        # Make sure filepath has correct extension
        if filepath.endswith('.h5') and not filepath.endswith('.weights.h5'):
            filepath = filepath[:-3] + '.weights.h5'
        elif not filepath.endswith('.weights.h5'):
            filepath += '.weights.h5'
        
        # Load weights
        self.model.load_weights(filepath)
        print(f"Model weights loaded from {filepath}")


class DroneRLInterface:
    """Interface for reinforcement learning with the drone simulation."""
    
    def __init__(self, uri="ws://localhost:8765"):
        self.uri = uri
        self.websocket = None
        self.connected = False
        self.drone_state = None
        self.training_mode = False
        self.episode_rewards = []
        self.best_reward = -float('inf')
        self.reconnect_attempts = 0
        self.max_reconnect_attempts = 5
        
        # Current state/action for RL
        self.current_state = None
        self.current_action = None
        
        # Missing attribute that caused the error
        self.isFlying = False  # Add this attribute
        
        # Define target landing spot coordinates based on script.js
        self.target_position = {
            'x': 30.0,  # End position from script.js
            'y': 0.0,   # Ground level
            'z': 30.0   # End position from script.js
        }
        
        # Define starting position based on script.js
        self.start_position = {
            'x': -30.0,  # Start position from script.js
            'y': 1.0,    # Slightly above ground level
            'z': -30.0   # Start position from script.js
        }
        
        self.target_radius = 2.5  # Match the terrain-controller.js check
        self.episode_steps = 0
        self.max_episode_steps = 1000
        
        # RL parameters - INITIALIZE AGENT BEFORE VISUALIZATION
        self.state_size = 15  # position, rotation, velocity, target distance
        self.action_size = 4  # thrust, pitch, roll, yaw
        self.agent = DQNAgent(self.state_size, self.action_size)
        self.batch_size = 32
        
        # Add proper state management
        self.training_state = "IDLE"  # IDLE, EPISODE_RUNNING, RESETTING
        self.reset_in_progress = False
        self.episode_start_time = 0
        
        # Initialize landing detection flags
        self.landing_detected = False
        self.landing_on_target = False
        
        # Initialize visualization AFTER agent is created
        self.setup_visualization()
        
        # Ensure directories exist at initialization
        os.makedirs("learning", exist_ok=True)
        os.makedirs("models", exist_ok=True)
        # Make sure we don't mix paths
        self.model_dir = "models"  # Separate from learning dir
        
        # Add properly initialized state variables
        self.prev_distance_to_target = None  # Initialized in episode start
        
        # Fix starting parameters
        self.min_altitude = 0.5  # Minimum altitude to consider as flying
        self.start_steps_grace_period = 20  # Steps to ignore tilt at start
    
    def setup_visualization(self):
        """Setup matplotlib visualization for training progress."""
        # Close any existing plots
        plt.close('all')
        
        # Simple backend that's most reliable
        try:
            import matplotlib
            matplotlib.use('Agg')  # Non-interactive backend for reliability
            print("Using Agg backend for reliable visualization")
        except Exception as e:
            print(f"Could not set matplotlib backend: {e}. Using default.")
        
        # Create a new figure with two subplots
        self.fig, (self.ax1, self.ax2) = plt.subplots(1, 2, figsize=(12, 5))
        
        # Episode reward plot
        self.ax1.set_title('Episode Rewards')
        self.ax1.set_xlabel('Episode')
        self.ax1.set_ylabel('Reward')
        self.reward_line, = self.ax1.plot([], [], 'b-o')
        
        # Exploration rate plot
        self.ax2.set_title('Exploration Rate')
        self.ax2.set_xlabel('Episode')
        self.ax2.set_ylabel('Epsilon')
        self.epsilon_line, = self.ax2.plot([], [], 'r-o')
        
        # Set initial limits
        self.ax1.set_xlim(0, 10)
        self.ax1.set_ylim(-100, 100)
        self.ax2.set_xlim(0, 10)
        self.ax2.set_ylim(0, 1)
        
        # Add grid
        self.ax1.grid(True)
        self.ax2.grid(True)
        
        # Adjust layout
        plt.tight_layout()
        
        # Create learning directory if it doesn't exist
        os.makedirs("learning", exist_ok=True)
        
        # Save initial empty plot
        self.fig.savefig("learning/training_progress.png")
        print("Initial visualization saved to learning/training_progress.png")
        
        # Set flag to indicate visualization is ready
        self.visualization_ready = True
    
    def update_visualization(self):
        """Update the visualization file (doesn't show on screen but saves to file)."""
        if not self.episode_rewards:
            return  # Nothing to visualize yet
            
        try:
            # Update episode reward plot
            episodes = list(range(1, len(self.episode_rewards) + 1))
            self.reward_line.set_data(episodes, self.episode_rewards)
            self.ax1.relim()
            self.ax1.autoscale_view()
            
            # Update exploration rate plot
            epsilon_values = [max(self.agent.epsilon * (self.agent.epsilon_decay ** i), 
                                 self.agent.epsilon_min) for i in range(len(episodes))]
            self.epsilon_line.set_data(episodes, epsilon_values)
            self.ax2.relim()
            self.ax2.autoscale_view()
            
            # Add title with current information
            best_reward = max(self.episode_rewards) if self.episode_rewards else 0
            self.fig.suptitle(f'Training Progress - Episode: {len(episodes)}, Best Reward: {best_reward:.2f}')
            
            # Save to file
            self.fig.savefig("learning/training_progress.png")
            print(f"Updated visualization saved with {len(self.episode_rewards)} episodes")
            
        except Exception as e:
            print(f"Error updating visualization: {e}")
    
    async def connect(self):
        """Connect to the drone simulation WebSocket server."""
        try:
            self.websocket = await websockets.connect(self.uri)
            self.connected = True
            self.reconnect_attempts = 0
            print(f"Connected to simulation at {self.uri}")
            
            # Enable external control
            await self.send_config(True)
            
            return True
        except Exception as e:
            print(f"Connection failed: {e}")
            self.connected = False
            return False
    
    async def disconnect(self):
        """Disconnect from the WebSocket server."""
        if self.websocket:
            await self.websocket.close()
            self.connected = False
            print("Disconnected from simulation")
    
    async def reconnect(self):
        """Attempt to reconnect to the WebSocket server."""
        if self.reconnect_attempts >= self.max_reconnect_attempts:
            print(f"Max reconnection attempts ({self.max_reconnect_attempts}) reached. Giving up.")
            return False
        
        print(f"Attempting to reconnect (attempt {self.reconnect_attempts + 1}/{self.max_reconnect_attempts})...")
        try:
            self.reconnect_attempts += 1
            self.websocket = await asyncio.wait_for(
                websockets.connect(self.uri), 
                timeout=10.0
            )
            self.connected = True
            print("Reconnected successfully.")
            
            # Reset reconnect attempts counter after successful connection
            self.reconnect_attempts = 0
            
            # Re-enable external control after reconnection
            await self.enable_external_control()
            return True
        except asyncio.TimeoutError:
            print("Connection failed: timed out")
            return False
        except Exception as e:
            print(f"Connection failed: {e}")
            return False
    
    async def send_message(self, message):
        """Send a message to the WebSocket server."""
        if not self.connected or not self.websocket:
            print("Not connected to server, attempting to reconnect...")
            reconnected = await self.reconnect()
            if not reconnected:
                return
        
        try:
            await self.websocket.send(json.dumps(message))
        except websockets.exceptions.ConnectionClosed:
            print("Connection closed when trying to send message. Attempting to reconnect...")
            self.connected = False
            reconnected = await self.reconnect()
            if reconnected:
                # Try again after reconnection
                try:
                    await self.websocket.send(json.dumps(message))
                except Exception as e:
                    print(f"Failed to send message after reconnection: {e}")
        except Exception as e:
            print(f"Error sending message: {e}")
            self.connected = False
            await self.reconnect()
    
    async def send_command(self, thrust, pitch, roll, yaw):
        """Send control commands to the drone."""
        # Clamp values to valid range
        thrust = max(0.0, min(1.0, float(thrust)))
        pitch = max(-1.0, min(1.0, float(pitch)))
        roll = max(-1.0, min(1.0, float(roll)))
        yaw = max(-1.0, min(1.0, float(yaw)))
        
        command = {
            "type": "control",
            "thrust": thrust,
            "pitch": pitch,
            "roll": roll,
            "yaw": yaw,
            "timestamp": int(time.time() * 1000)
        }
        
        await self.send_message(command)
    
    async def reset_simulation(self):
        """Reset the drone to initial position."""
        # Don't reset if already resetting
        if self.reset_in_progress:
            return
            
        try:
            # Set state to indicate reset is in progress
            self.reset_in_progress = True
            self.training_state = "RESETTING"
            
            print("\n🔄 RESETTING SIMULATION")
            
            # First, stop all drone movement
            await self.send_command(0.0, 0.0, 0.0, 0.0)
            await asyncio.sleep(0.2)
            
            # Send a simple reset message
            reset_msg = {
                "type": "reset",
                "timestamp": int(time.time() * 1000)
            }
            
            print("Sending reset command to browser...")
            await self.send_message(reset_msg)
            
            # Reset internal state
            self.current_state = None
            self.current_action = None
            self.episode_steps = 0
            
            # Wait for reset to complete
            await asyncio.sleep(3.0)
            
            print("Reset complete")
        finally:
            # Always clear the reset flag
            self.reset_in_progress = False
    
    async def send_config(self, enable_external_control):
        """Configure the simulation."""
        config = {
            "type": "config",
            "externalControl": enable_external_control,
            "timestamp": int(time.time() * 1000)
        }
        
        try:
            await self.send_message(config)
            print(f"External control {'enabled' if enable_external_control else 'disabled'}")
            return True  # Return True to indicate success
        except Exception as e:
            print(f"Error configuring external control: {e}")
            return False  # Return False to indicate failure
    
    async def receive_messages(self):
        """Continuously receive and process messages from the server."""
        print("Starting to receive messages from server...")
        if not self.connected or not self.websocket:
            print("Cannot receive messages: not connected")
            await self.reconnect()
            return
        
        try:
            async for message in self.websocket:
                try:
                    data = json.loads(message)
                    message_type = data.get('type', '')
                    
                    if message_type == 'state':
                        # Add target position information if not already present
                        if 'targetPosition' not in data:
                            data['targetPosition'] = self.target_position
                        
                        # Update drone state
                        self.drone_state = data
                        
                        if self.training_mode:
                            # Process state for training
                            await self.process_state(data)
                    
                except json.JSONDecodeError as e:
                    print(f"Error decoding JSON: {e}")
                except Exception as e:
                    print(f"Error processing message: {e}")
                    import traceback
                    traceback.print_exc()
        
        except websockets.exceptions.ConnectionClosed:
            print("WebSocket connection closed")
            self.connected = False
            await self.reconnect()
        
        except Exception as e:
            print(f"Error in receive_messages: {e}")
            import traceback
            traceback.print_exc()
            self.connected = False
            await self.reconnect()
    
    async def process_state(self, state_data):
        """Process state data only when in a valid training state."""
        # Skip if not in training mode
        if not self.training_mode:
            return
            
        # Only process state if in EPISODE_RUNNING state
        if self.training_state != "EPISODE_RUNNING":
            return
            
        try:
            # Extract features from state
            state_features = self.extract_state_features(state_data)
            state_vector = np.array([state_features])
            
            # Check if we have a previous state to work with
            if self.current_state is not None:
                # Calculate reward
                reward = self.calculate_reward(state_data)
                
                # Check if episode is done
                done = self.is_episode_done(state_data)
                
                # Store the experience in replay memory
                self.agent.memorize(
                    self.current_state,
                    self.current_action,
                    reward,
                    state_vector,
                    done
                )
                
                # Train the agent 
                if len(self.agent.memory) > self.batch_size:
                    self.agent.replay(self.batch_size)
                
                # If episode is done, reset the state and simulation
                if done:
                    print("Episode termination detected in process_state")
                    self.current_state = None
                    self.current_action = None
                    # Schedule a reset but don't wait for it here
                    asyncio.create_task(self.reset_simulation())
                    return
            
            # Select an action based on the current state
            action = self.agent.act(state_vector)
            
            # Store current state and action for the next step
            self.current_state = state_vector
            self.current_action = action
            
            # Send control command to drone
            await self.send_control_command(action)
        except Exception as e:
            print(f"Error in process_state: {e}")
            import traceback
            traceback.print_exc()
    
    def extract_state_features(self, state_data):
        """Extract features from state data for the neural network."""
        if not state_data:
            print("WARNING: No state data available for feature extraction")
            return np.zeros(self.state_size)
        
        # Position data
        pos = state_data.get('position', {})
        if pos is None: pos = {}
        x = pos.get('x', 0)
        y = pos.get('y', 0)
        z = pos.get('z', 0)
        
        # Rotation data (in degrees)
        rot = state_data.get('rotation', {})
        if rot is None: rot = {}
        pitch = rot.get('x', 0)
        yaw = rot.get('y', 0)
        roll = rot.get('z', 0)
        
        # Velocity data
        vel = state_data.get('velocity', {})
        if vel is None: vel = {}
        vx = vel.get('x', 0)
        vy = vel.get('y', 0)
        vz = vel.get('z', 0)
        
        # Normalize rotation to be between -1 and 1 (from degrees)
        pitch_norm = max(-1.0, min(1.0, pitch / 180.0))
        yaw_norm = max(-1.0, min(1.0, yaw / 180.0))
        roll_norm = max(-1.0, min(1.0, roll / 180.0))
        
        # Target position data
        target_pos = self.target_position
        target_x = target_pos.get('x', 0)
        target_y = target_pos.get('y', 0)
        target_z = target_pos.get('z', 0)
        
        # Calculate distance to target
        dx = x - target_x
        dy = y - target_y
        dz = z - target_z
        distance = np.sqrt(dx*dx + dy*dy + dz*dz)
        
        # Normalize distance (assuming max distance ~ 100)
        distance_norm = min(1.0, distance / 100.0)
        
        # Create feature vector
        features = [
            x / 50.0,    # Normalized position
            y / 50.0,
            z / 50.0,
            pitch_norm,  # Normalized rotation
            yaw_norm,
            roll_norm,
            vx / 10.0,   # Normalized velocity
            vy / 10.0,
            vz / 10.0,
            dx / 100.0,  # Normalized direction to target
            dy / 100.0,
            dz / 100.0,
            distance_norm,  # Normalized distance to target
            distance_norm * 0.5, # Half of distance (additional feature)
            1.0 if y < self.min_altitude else 0.0  # Near ground indicator
        ]
        
        # Print state summary every 10 steps
        if self.episode_steps % 10 == 0:
            print(f"\nSTATE [Step {self.episode_steps}]:")
            print(f"Position: x={x:.1f}, y={y:.1f}, z={z:.1f}")
            print(f"Rotation: pitch={pitch:.1f}°, yaw={yaw:.1f}°, roll={roll:.1f}°")
            print(f"Velocity: vx={vx:.1f}, vy={vy:.1f}, vz={vz:.1f}")
            print(f"Distance to target: {distance:.2f}m (dx={dx:.2f}, dy={dy:.2f}, dz={dz:.2f})")
            print(f"Height from ground: {y:.2f}m")
        
        return np.array(features)
    
    def calculate_reward(self, state_data):
        """Calculate reward based on drone state."""
        if not state_data:
            return 0.0
        
        # Position
        pos = state_data.get('position', {})
        if pos is None: pos = {}
        x = pos.get('x', 0)
        y = pos.get('y', 0)
        z = pos.get('z', 0)
        
        # Calculate distance to target
        target_x = self.target_position['x']
        target_y = self.target_position['y']
        target_z = self.target_position['z']
        
        dx = x - target_x
        dy = y - target_y
        dz = z - target_z
        
        # 3D distance to target
        distance = np.sqrt(dx*dx + dy*dy + dz*dz)
        
        # 2D distance (for landing precision)
        horizontal_distance = np.sqrt(dx*dx + dz*dz)
        
        # Initialize reward components
        time_penalty = -0.1  # Small penalty for each time step
        distance_reward = 0.0
        progress_reward = 0.0
        landing_reward = 0.0
        
        # Distance reward - small reward for being close to target
        distance_reward = 5.0 / (distance + 1.0)  # Avoid division by zero
        
        # Progress reward - reward for moving closer to target
        if self.prev_distance_to_target is not None:
            # Progress is the change in distance (negative is good)
            progress = self.prev_distance_to_target - distance
            progress_reward = progress * 10.0  # Scale up the progress reward
        
        # Update previous distance
        self.prev_distance_to_target = distance
        
        # Landing reward
        is_landed = y < self.min_altitude
        if is_landed:
            if horizontal_distance < self.target_radius:
                landing_reward = 200.0  # Big reward for landing on target
            else:
                landing_reward = -200.0  # Big penalty for landing away from target
        
        # Calculate total reward
        total_reward = time_penalty + distance_reward + progress_reward + landing_reward
        
        # Cap reward to prevent extreme values
        total_reward = max(-1000.0, min(1000.0, total_reward))
        
        if abs(total_reward) > 10.0:
            # Log significant rewards for debugging
            print(f"Significant reward: {total_reward:.2f} (time: {time_penalty:.2f}, distance: {distance_reward:.2f}, progress: {progress_reward:.2f}, landing: {landing_reward:.2f})")
        
        return total_reward
    
    def is_drone_at_starting_position(self, state_data):
        """Check if drone is at the starting position vs actually landed."""
        if not state_data or 'position' not in state_data:
            return False
            
        pos = state_data['position']
        x = pos.get('x', 0)
        y = pos.get('y', 0) 
        z = pos.get('z', 0)
        
        # Check if position is close to starting position
        dx = abs(x - self.start_position['x'])
        dy = abs(y - self.start_position['y'])
        dz = abs(z - self.start_position['z'])
        
        # If very close to starting position
        return dx < 3.0 and dy < 3.0 and dz < 3.0
        
    def is_episode_done(self, state_data):
        """Check if the current episode is finished."""
        # Skip if we're not in an active episode
        if self.training_state != "EPISODE_RUNNING":
            return False
            
        if not state_data:
            self.episode_done_reason = "Episode done: No state data available"
            return True
        
        # Give the drone a grace period at the start (needed to avoid extreme tilt detection)
        if self.episode_steps < self.start_steps_grace_period:
            return False
        
        # Get position data
        pos = state_data.get('position', {})
        if pos is None: pos = {}
        
        x = pos.get('x', 0)
        y = pos.get('y', 0)  # Height
        z = pos.get('z', 0)
        
        # Get rotation data (for tilt detection)
        rot = state_data.get('rotation', {})
        if rot is None: rot = {}
            
        pitch = rot.get('x', 0)
        roll = rot.get('z', 0)
        
        # Calculate distance to landing target (horizontal only)
        dx = x - self.target_position['x']
        dz = z - self.target_position['z']
        distance_to_target_xz = np.sqrt(dx**2 + dz**2)
        
        # Reset reason
        self.episode_done_reason = None
        
        # Check if drone has tilted too much (crash condition)
        max_tilt = 75  # Maximum allowed tilt in degrees
        if abs(pitch) > max_tilt or abs(roll) > max_tilt:
            self.episode_done_reason = f"⚠️ MISSION FAILED: Extreme tilt (pitch: {pitch:.1f}°, roll: {roll:.1f}°)"
            return True
        
        # Check if the drone has landed (height near ground)
        is_landed = y < self.min_altitude
        
        if is_landed and self.episode_steps > self.start_steps_grace_period:
            if distance_to_target_xz < self.target_radius:
                self.episode_done_reason = f"🎯 MISSION SUCCESSFUL: Landed on target! Distance: {distance_to_target_xz:.2f}m"
            else:
                self.episode_done_reason = f"❌ MISSION FAILED: Landed outside target area. Distance: {distance_to_target_xz:.2f}m"
            return True
        
        # Episode done if max steps reached
        if self.episode_steps >= self.max_episode_steps:
            self.episode_done_reason = f"⏱️ MISSION FAILED: Maximum steps reached ({self.max_episode_steps})"
            return True
            
        # Continue episode
        return False
    
    async def handle_landing(self, state_data, is_on_target):
        """Handle landing event with explicit messaging and reset."""
        # Only process if not already handling a landing
        if hasattr(self, 'landing_handling_in_progress') and self.landing_handling_in_progress:
            return
            
        # Set flag to prevent multiple landing handlers
        self.landing_handling_in_progress = True
        
        try:
            # Get position data
            pos = state_data.get('position', {})
            if pos is None: pos = {}
            x = pos.get('x', 0)
            z = pos.get('z', 0)
            
            # Calculate distance to target
            dx = x - self.target_position['x']
            dz = z - self.target_position['z']
            distance = np.sqrt(dx**2 + dz**2)
            
            # Log landing very explicitly in console
            if is_on_target:
                print("\n" + "=" * 50)
                print("🎯 SUCCESSFUL LANDING ON TARGET!")
                print(f"Distance to target center: {distance:.2f} meters")
                print("=" * 50 + "\n")
            else:
                print("\n" + "=" * 50)
                print("❌ LANDING FAILURE - MISSED TARGET!")
                print(f"Distance to target: {distance:.2f} meters")
                print("=" * 50 + "\n")
            
            # Force stop all movement
            await self.send_command(0.0, 0.0, 0.0, 0.0)
            
            # Force reset
            await self.force_reset_simulation()
            
        finally:
            # Always clear the flag when done
            self.landing_handling_in_progress = False
    
    async def force_reset_simulation(self):
        """Force reset the simulation with locking to prevent multiple simultaneous resets."""
        # If reset is already in progress, wait for it to complete
        if self.reset_in_progress:
            print("Reset already in progress. Waiting...")
            # Wait for up to 10 seconds for current reset to complete
            start_time = time.time()
            while self.reset_in_progress and time.time() - start_time < 10.0:
                await asyncio.sleep(0.5)
            return True  # Assume reset completed
            
        # Use an async lock to prevent multiple reset operations
        async with self.reset_lock:
            try:
                # Set flag to indicate reset is in progress
                self.reset_in_progress = True
                
                print("\n" + "!" * 50)
                print("🔄 FORCING SIMULATION RESET")
                print("!" * 50 + "\n")
                
                # First stop the drone
                await self.send_command(0.0, 0.0, 0.0, 0.0)
                await asyncio.sleep(0.5)
                
                # Send reset message
                reset_msg = {
                    "type": "reset",
                    "force": True,
                    "timestamp": int(time.time() * 1000)
                }
                
                # Send reset message
                await self.send_message(reset_msg)
                
                # Reset internal state
                self.current_state = None
                self.current_action = None
                self.episode_steps = 0
                
                # Wait for reset with clear countdown
                print("Waiting for reset to complete...")
                for i in range(5, 0, -1):
                    print(f"Reset countdown: {i}")
                    await asyncio.sleep(1.0)
                
                # Stabilize the drone
                await self.send_command(0.5, 0.0, 0.0, 0.0)
                
                print("Reset completed\n")
                return True
                
            finally:
                # Always clear the reset flag when done, even if there was an error
                self.reset_in_progress = False
    
    async def train(self, episodes=50, steps_per_episode=1000):
        """Train the agent on the drone simulation."""
        # Setup directories
        os.makedirs("learning", exist_ok=True)
        os.makedirs("models", exist_ok=True)
        
        # Initialize tracking variables
        self.episode_rewards = []
        if hasattr(self, 'fig'):
            plt.close(self.fig)
        self.setup_visualization()
        
        self.training_mode = True
        self.max_episode_steps = steps_per_episode
        current_episode = 0
        
        print("\n====== STARTING TRAINING ======\n")
        
        try:
            # Enable external control
            await self.send_config(True)
            await asyncio.sleep(1.0)
            
            # Training loop
            while current_episode < episodes:
                # Clear state for new episode
                self.episode_steps = 0
                self.episode_done_reason = None
                episode_reward = 0.0
                self.prev_distance_to_target = None  # Will be set on first step
                
                print(f"\n====== EPISODE {current_episode+1}/{episodes} ======")
                
                # Reset simulation for new episode
                if not self.reset_in_progress:
                    await self.reset_simulation()
                
                # Wait to ensure we have state data after reset
                wait_start = time.time()
                while not self.drone_state and time.time() - wait_start < 5.0:
                    print("Waiting for drone state...")
                    await asyncio.sleep(0.5)
                
                if not self.drone_state:
                    print("No drone state after waiting. Skipping episode.")
                    continue
                
                # Get initial distance to target
                initial_state = self.extract_state_features(self.drone_state)
                pos = self.drone_state.get('position', {})
                if pos:
                    x = pos.get('x', 0)
                    y = pos.get('y', 0)
                    z = pos.get('z', 0)
                    dx = x - self.target_position['x']
                    dy = y - self.target_position['y']
                    dz = z - self.target_position['z']
                    self.prev_distance_to_target = np.sqrt(dx*dx + dy*dy + dz*dz)
                
                # Set state to running with short grace period for stabilization
                await asyncio.sleep(1.0)  # Wait for drone to stabilize after reset
                self.training_state = "EPISODE_RUNNING"
                self.episode_start_time = time.time()
                print("\n▶️ EPISODE STARTED")
                
                # Episode main loop
                while self.training_state == "EPISODE_RUNNING" and self.episode_steps < steps_per_episode:
                    # Print step marker for visibility
                    if self.episode_steps % 10 == 0:
                        print(f"\n--- Step {self.episode_steps}/{steps_per_episode} ---")
                    
                    # Increment step counter
                    self.episode_steps += 1
                    
                    # Check if we have drone state
                    if not self.drone_state:
                        print("No drone state available")
                        await asyncio.sleep(0.1)
                        continue
                    
                    # Extract state features
                    state_features = self.extract_state_features(self.drone_state)
                    state_vector = np.array([state_features])
                    
                    # Check if episode is done
                    if self.is_episode_done(self.drone_state):
                        if self.episode_done_reason:
                            print(f"\n{self.episode_done_reason}")
                        
                        # Calculate final reward and log it
                        reward = self.calculate_reward(self.drone_state)
                        print(f"FINAL REWARD: {reward:.2f}")
                        episode_reward += reward
                        
                        # Store final experience
                        if self.current_state is not None and self.current_action is not None:
                            self.agent.memorize(
                                self.current_state,
                                self.current_action,
                                reward,
                                state_vector,
                                True  # Done
                            )
                            print(f"Stored final experience with reward {reward:.2f}")
                        
                        # Clean up episode
                        print("\n⏹️ EPISODE ENDED")
                        self.training_state = "IDLE"
                        await self.reset_simulation()
                        break
                    
                    # Select action using agent
                    action = self.agent.act(state_vector)
                    
                    # Log chosen action if epsilon-greedy randomness was used
                    if np.random.rand() <= self.agent.epsilon:
                        print(f"EXPLORATION: Using random action (ε={self.agent.epsilon:.4f})")
                    else:
                        print(f"EXPLOITATION: Using model action (ε={self.agent.epsilon:.4f})")
                    
                    # Calculate reward and log it
                    reward = self.calculate_reward(self.drone_state)
                    if abs(reward) > 5:  # Only log significant rewards
                        print(f"REWARD: {reward:.2f}")
                    episode_reward += reward
                    
                    # Store experience in memory
                    if self.current_state is not None and self.current_action is not None:
                        self.agent.memorize(
                            self.current_state,
                            self.current_action,
                            reward,
                            state_vector,
                            False  # Not done
                        )
                    
                    # Update current state and action
                    self.current_state = state_vector
                    self.current_action = action
                    
                    # Send control command
                    await self.send_control_command(action)
                    
                    # Train on batch and log progress
                    if len(self.agent.memory) > self.batch_size:
                        self.agent.replay(self.batch_size)
                        if self.episode_steps % 20 == 0:
                            print(f"MODEL TRAINING: Memory buffer size: {len(self.agent.memory)}")
                    
                    # Small delay
                    await asyncio.sleep(0.1)
                
                # Episode completed
                episode_duration = time.time() - self.episode_start_time
                if episode_duration > 1.0:  # Only count episodes that actually ran
                    # Record detailed results
                    print(f"\n---- Episode {current_episode+1} Results ----")
                    print(f"Duration: {episode_duration:.2f} seconds")
                    print(f"Steps: {self.episode_steps}")
                    print(f"Total Reward: {episode_reward:.2f}")
                    print(f"Exploration rate (ε): {self.agent.epsilon:.4f}")
                    print(f"Memory buffer size: {len(self.agent.memory)}")
                    
                    # Calculate distance to target at end of episode
                    if self.drone_state and 'position' in self.drone_state:
                        pos = self.drone_state['position']
                        x = pos.get('x', 0)
                        y = pos.get('y', 0)
                        z = pos.get('z', 0)
                        dx = x - self.target_position['x']
                        dy = y - self.target_position['y']
                        dz = z - self.target_position['z']
                        final_distance = np.sqrt(dx*dx + dy*dy + dz*dz)
                        print(f"Final distance to target: {final_distance:.2f}m")
                    
                    # Save episode data
                    self.episode_rewards.append(episode_reward)
                    self.update_visualization()
                    print("Updated visualization with episode results")
                    
                    # Save models (FIX: use correct directory paths)
                    model_path = os.path.join(self.model_dir, f"drone_model_episode_{current_episode+1}")
                    self.agent.save(model_path)
                    
                    latest_path = os.path.join(self.model_dir, "drone_model_latest")
                    self.agent.save(latest_path)
                    
                    # Save best model
                    if episode_reward > self.best_reward:
                        self.best_reward = episode_reward
                        best_path = os.path.join(self.model_dir, "drone_model_best")
                        self.agent.save(best_path)
                        print(f"New best reward: {episode_reward:.2f}!")
                    
                    # Increment episode counter
                    current_episode += 1
                else:
                    print("Episode too short, not counting it")
                
                # Cooling period between episodes
                print("Cooling period between episodes...")
                await asyncio.sleep(2.0)
            
            print("\n====== TRAINING COMPLETED ======")
            return self.episode_rewards
            
        except Exception as e:
            print(f"Error during training: {e}")
            import traceback
            traceback.print_exc()
            return self.episode_rewards
    
    def save_training_results(self, filename="training_results"):
        """Save training results to file."""
        # Create learning directory if it doesn't exist
        os.makedirs("learning", exist_ok=True)
        
        # Ensure filename is in the learning directory
        if not filename.startswith("learning/"):
            filename = f"learning/{filename}"
        
        # Save rewards
        np.savetxt(f"{filename}_rewards.csv", self.episode_rewards, delimiter=",")
        
        # Save reward plot
        plt.figure(figsize=(10, 6))
        plt.plot(self.episode_rewards)
        plt.title('Training Rewards')
        plt.xlabel('Episode')
        plt.ylabel('Total Reward')
        plt.savefig(f"{filename}_rewards.png")
        plt.close()
        
        print(f"Training results saved to {filename}_rewards.csv and {filename}_rewards.png")

    async def send_control_command(self, action):
        """Send control command to the drone using the action values."""
        # Map continuous action values from [-1, 1] to the expected ranges
        # For thrust, map from [-1, 1] to [0, 1]
        thrust = (action[0] + 1) / 2.0  # Convert from [-1, 1] to [0, 1]
        pitch = action[1]  # Use direct value for pitch [-1, 1]
        roll = action[2]   # Use direct value for roll [-1, 1]
        yaw = action[3]    # Use direct value for yaw [-1, 1]
        
        # Limit values to valid ranges
        thrust = max(0.0, min(1.0, thrust))
        pitch = max(-1.0, min(1.0, pitch))
        roll = max(-1.0, min(1.0, roll))
        yaw = max(-1.0, min(1.0, yaw))
        
        # Log command periodically
        if self.episode_steps % 10 == 0:
            print(f"CONTROL: thrust={thrust:.2f}, pitch={pitch:.2f}, roll={roll:.2f}, yaw={yaw:.2f}")
        
        # Send command to drone
        await self.send_command(thrust, pitch, roll, yaw)

    async def enable_external_control(self):
        """Enable external control of the drone."""
        if not self.connected or not self.websocket:
            print("Cannot enable external control: not connected")
            return False
        
        try:
            control_msg = {
                "type": "control",
                "action": "enable"
            }
            await self.send_message(control_msg)
            print("External control enabled")
            return True
        except Exception as e:
            print(f"Error enabling external control: {e}")
            return False

async def main():
    """Main function to run the drone reinforcement learning experiment."""
    import argparse
    
    parser = argparse.ArgumentParser(description='Train a drone to land using reinforcement learning')
    parser.add_argument('--uri', type=str, default="ws://localhost:8765", help='WebSocket URI for the drone simulator')
    parser.add_argument('--episodes', type=int, default=50, help='Number of training episodes')
    parser.add_argument('--steps', type=int, default=1000, help='Maximum steps per episode')
    parser.add_argument('--load', type=str, default="models/drone_model_latest", 
                        help='Load model from specified path (default: models/drone_model_latest)')
    parser.add_argument('--reconnect-attempts', type=int, default=10, 
                        help='Maximum number of reconnection attempts (default: 10)')
    parser.add_argument('--save-interval', type=int, default=1, 
                        help='Save model every N episodes (default: 1)')
    args = parser.parse_args()
    
    # Create the drone interface
    interface = DroneRLInterface(uri=args.uri)
    
    # Set reconnection attempts from argument
    interface.max_reconnect_attempts = args.reconnect_attempts
    
    # Connect to the simulator
    connected = await interface.connect()
    if not connected:
        print("Failed to connect to simulator. Exiting.")
        return
    
    # Start receiving messages in the background
    receive_task = asyncio.create_task(interface.receive_messages())
    
    # Load existing model if it exists
    try:
        if args.load:
            # Check if the specified model file exists
            if os.path.exists(f"{args.load}.index") or os.path.exists(args.load):
                interface.agent.load(args.load)
                print(f"Loaded model from {args.load}")
            else:
                print(f"Model file {args.load} not found. Starting with a new model.")
                # Create the models directory if it doesn't exist
                os.makedirs("models", exist_ok=True)
    except Exception as e:
        print(f"Error loading model: {e}")
        print("Starting with a new model.")
    
    try:
        # Wait a bit for connection to stabilize
        await asyncio.sleep(2)
        
        # Train the agent
        print("Starting training...")
        rewards = await interface.train(episodes=args.episodes, steps_per_episode=args.steps)
        
        # Save results
        interface.save_training_results()
        
        print(f"Training completed with {len(rewards)} episodes")
        
    except KeyboardInterrupt:
        print("Training interrupted by user")
        
        # Save model on interruption
        try:
            interface.agent.save("models/drone_model_interrupted")
            print("Model saved after interruption")
        except Exception as e:
            print(f"Error saving model after interruption: {e}")
            
    except Exception as e:
        print(f"Error in main: {e}")
        import traceback
        traceback.print_exc()
        
        # Save model on exception
        try:
            interface.agent.save("models/drone_model_error")
            print("Model saved after error")
        except Exception as save_error:
            print(f"Error saving model after exception: {save_error}")
            
    finally:
        # Clean up
        receive_task.cancel()
        try:
            await receive_task
        except asyncio.CancelledError:
            pass
        
        await interface.disconnect()
        print("Disconnected from simulator")

# Run the main function
if __name__ == "__main__":
    asyncio.run(main()) 