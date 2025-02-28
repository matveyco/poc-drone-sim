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
        # Make sure filepath has correct extension
        if filepath.endswith('.h5') and not filepath.endswith('.weights.h5'):
            filepath = filepath[:-3] + '.weights.h5'
        elif not filepath.endswith('.weights.h5'):
            filepath += '.weights.h5'
            
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
        
        # Initialize visualization
        self.setup_visualization()
        
        # RL parameters
        self.state_size = 12  # position, rotation, velocity, angular velocity
        self.action_size = 4  # thrust, pitch, roll, yaw
        self.agent = DQNAgent(self.state_size, self.action_size)
        self.batch_size = 32
    
    def setup_visualization(self):
        """Set up visualization for training progress."""
        plt.ion()  # Enable interactive mode
        self.fig, self.ax = plt.subplots(figsize=(10, 6))
        self.ax.set_title('Drone Training Progress')
        self.ax.set_xlabel('Episode')
        self.ax.set_ylabel('Total Reward')
        self.line, = self.ax.plot([], [], 'b-')
        self.fig.tight_layout()
        plt.show(block=False)
    
    def update_visualization(self):
        """Update the visualization with current rewards."""
        if not self.episode_rewards:
            return
        
        episodes = list(range(1, len(self.episode_rewards) + 1))
        self.line.set_data(episodes, self.episode_rewards)
        
        # Adjust axes
        self.ax.relim()
        self.ax.autoscale_view()
        
        # Redraw plot
        self.fig.canvas.draw()
        self.fig.canvas.flush_events()
    
    async def connect(self):
        """Connect to the drone simulation WebSocket server."""
        try:
            self.websocket = await websockets.connect(self.uri)
            self.connected = True
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
    
    async def send_message(self, message):
        """Send a message to the WebSocket server."""
        if not self.connected or not self.websocket:
            print("Not connected to server")
            return
        
        try:
            await self.websocket.send(json.dumps(message))
        except Exception as e:
            print(f"Error sending message: {e}")
            self.connected = False
    
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
        reset_msg = {
            "type": "reset",
            "timestamp": int(time.time() * 1000)
        }
        
        await self.send_message(reset_msg)
        print("Reset command sent")
        
        # Wait a bit for the simulation to reset
        await asyncio.sleep(1.0)
    
    async def send_config(self, enable_external_control):
        """Configure the simulation."""
        config = {
            "type": "config",
            "externalControl": enable_external_control,
            "timestamp": int(time.time() * 1000)
        }
        
        await self.send_message(config)
        print(f"External control {'enabled' if enable_external_control else 'disabled'}")
    
    async def receive_messages(self):
        """Continuously receive and process messages from the server."""
        if not self.connected or not self.websocket:
            print("Cannot receive messages: not connected")
            return
        
        try:
            async for message in self.websocket:
                try:
                    data = json.loads(message)
                    
                    if data.get('type') == 'state':
                        # Update drone state
                        self.drone_state = data
                        
                        # Process state for RL if in training mode
                        if self.training_mode and hasattr(self, 'current_state'):
                            # Extract state features
                            state_features = self.extract_state_features(data)
                            next_state = np.reshape(state_features, [1, self.state_size])
                            
                            # If we have a previous state, calculate reward
                            if self.current_state is not None and self.current_action is not None:
                                reward = self.calculate_reward(data)
                                
                                # Check if episode is done
                                done = self.is_episode_done(data)
                                
                                # Store in replay memory
                                self.agent.memorize(
                                    self.current_state, 
                                    self.current_action, 
                                    reward, 
                                    next_state, 
                                    done
                                )
                                
                                # Train the agent
                                self.agent.replay(self.batch_size)
                                
                                # Update current state
                                self.current_state = None if done else next_state
                                
                                # Get and apply next action if not done
                                if not done:
                                    self.current_action = self.agent.act(next_state)
                                    await self.send_command(
                                        self.current_action[0],  # thrust
                                        self.current_action[1],  # pitch
                                        self.current_action[2],  # roll
                                        self.current_action[3]   # yaw
                                    )
                            else:
                                # Initialize state and action
                                self.current_state = next_state
                                self.current_action = self.agent.act(next_state)
                                await self.send_command(
                                    self.current_action[0],  # thrust
                                    self.current_action[1],  # pitch
                                    self.current_action[2],  # roll
                                    self.current_action[3]   # yaw
                                )
                
                except json.JSONDecodeError:
                    print(f"Invalid JSON received from server")
                except Exception as e:
                    print(f"Error processing message: {e}")
        
        except websockets.exceptions.ConnectionClosed:
            print("WebSocket connection closed")
            self.connected = False
        except Exception as e:
            print(f"Error receiving messages: {e}")
            self.connected = False
    
    def extract_state_features(self, state_data):
        """Extract relevant features from drone state for RL."""
        if not state_data:
            return np.zeros(self.state_size)
        
        # Extract position
        pos = state_data.get('position', {})
        x = pos.get('x', 0)
        y = pos.get('y', 0)
        z = pos.get('z', 0)
        
        # Extract rotation
        rot = state_data.get('rotation', {})
        pitch = rot.get('x', 0)
        yaw = rot.get('y', 0)
        roll = rot.get('z', 0)
        
        # Extract velocity
        vel = state_data.get('velocity', {})
        vx = vel.get('x', 0)
        vy = vel.get('y', 0)
        vz = vel.get('z', 0)
        
        # Extract angular velocity
        ang_vel = state_data.get('angularVelocity', {})
        ang_x = ang_vel.get('x', 0)
        ang_y = ang_vel.get('y', 0)
        ang_z = ang_vel.get('z', 0)
        
        # Normalize values to [-1, 1] range
        x = np.clip(x / 10.0, -1, 1)
        y = np.clip(y / 10.0, -1, 1)
        z = np.clip(z / 10.0, -1, 1)
        
        pitch = np.clip(pitch / 90.0, -1, 1)
        yaw = np.clip(yaw / 180.0, -1, 1)
        roll = np.clip(roll / 90.0, -1, 1)
        
        vx = np.clip(vx / 5.0, -1, 1)
        vy = np.clip(vy / 5.0, -1, 1)
        vz = np.clip(vz / 5.0, -1, 1)
        
        ang_x = np.clip(ang_x / 180.0, -1, 1)
        ang_y = np.clip(ang_y / 180.0, -1, 1)
        ang_z = np.clip(ang_z / 180.0, -1, 1)
        
        # Combine features
        return np.array([x, y, z, pitch, yaw, roll, vx, vy, vz, ang_x, ang_y, ang_z])
    
    def calculate_reward(self, state_data):
        """Calculate reward based on drone state."""
        if not state_data:
            return -10.0  # Penalty for invalid state
        
        # Extract position and rotation
        pos = state_data.get('position', {})
        y = pos.get('y', 0)  # Height
        
        rot = state_data.get('rotation', {})
        pitch = abs(rot.get('x', 0))
        roll = abs(rot.get('z', 0))
        
        # Extract velocities
        vel = state_data.get('velocity', {})
        vy = vel.get('y', 0)  # Vertical velocity
        
        ang_vel = state_data.get('angularVelocity', {})
        ang_x = abs(ang_vel.get('x', 0))  # Pitch rate
        ang_z = abs(ang_vel.get('z', 0))  # Roll rate
        
        # Define target height
        target_height = 5.0
        
        # Reward components
        height_reward = -abs(y - target_height)  # Negative distance to target height
        stable_reward = -(pitch + roll) / 10.0   # Negative tilt (want to be level)
        velocity_reward = -abs(vy) / 2.0         # Negative vertical speed (want to hover)
        angular_rate_reward = -(ang_x + ang_z) / 20.0  # Negative angular rates (want to be stable)
        
        # Check if drone is out of bounds or crashed
        out_of_bounds_penalty = 0
        if abs(pos.get('x', 0)) > 20 or abs(pos.get('z', 0)) > 20 or y < 0 or y > 20:
            out_of_bounds_penalty = -10.0
        
        # Combined reward
        reward = (
            0.5 * height_reward +
            0.2 * stable_reward +
            0.2 * velocity_reward +
            0.1 * angular_rate_reward +
            out_of_bounds_penalty
        )
        
        return reward
    
    def is_episode_done(self, state_data):
        """Check if the current episode is finished."""
        if not state_data:
            return True
        
        pos = state_data.get('position', {})
        y = pos.get('y', 0)  # Height
        
        # Check if crashed or out of bounds
        if y < 0 or y > 20:
            return True
        
        if abs(pos.get('x', 0)) > 20 or abs(pos.get('z', 0)) > 20:
            return True
        
        # Check if extremely tilted
        rot = state_data.get('rotation', {})
        pitch = abs(rot.get('x', 0))
        roll = abs(rot.get('z', 0))
        
        if pitch > 60 or roll > 60:
            return True
        
        return False
    
    async def train(self, episodes=50, steps_per_episode=1000):
        """Train the agent on the drone simulation."""
        self.training_mode = True
        self.episode_rewards = []
        
        for episode in range(episodes):
            print(f"Starting episode {episode+1}/{episodes}")
            
            # Reset simulation
            await self.reset_simulation()
            
            # Reset variables for this episode
            self.current_state = None
            self.current_action = None
            episode_reward = 0
            
            # Run episode
            for step in range(steps_per_episode):
                # Check if we're still connected
                if not self.connected:
                    print("Connection lost. Stopping training.")
                    return self.episode_rewards
                
                # Check if episode is done
                if self.current_state is None and step > 0:
                    print(f"Episode ended after {step} steps")
                    break
                
                await asyncio.sleep(0.05)  # Control rate limiter
                
                # Accumulate reward for visualization
                if self.drone_state:
                    episode_reward += self.calculate_reward(self.drone_state)
            
            # Episode complete
            self.episode_rewards.append(episode_reward)
            print(f"Episode {episode+1} complete. Total reward: {episode_reward:.4f}")
            
            # Update best reward
            if episode_reward > self.best_reward:
                self.best_reward = episode_reward
                print(f"New best reward: {self.best_reward:.4f}")
            
            # Save model periodically or when new best
            if (episode + 1) % 5 == 0 or episode_reward == self.best_reward:
                # Save model with proper file extension
                model_path = f"drone_model_episode_{episode+1}"
                self.agent.save(model_path)
            
            # Update visualization after each episode
            self.update_visualization()
        
        print("Training complete")
        self.training_mode = False
        
        # Final model save
        self.agent.save("drone_model_final")
        print("Final model saved")
        
        return self.episode_rewards
    
    def save_training_results(self, filename="training_results"):
        """Save training results to file."""
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

async def main():
    """Main function to run the drone RL interface."""
    import argparse
    
    parser = argparse.ArgumentParser(description='Train a drone using reinforcement learning')
    parser.add_argument('--episodes', type=int, default=50, help='Number of episodes to train')
    parser.add_argument('--steps', type=int, default=1000, help='Maximum steps per episode')
    parser.add_argument('--uri', type=str, default='ws://localhost:8765', help='WebSocket URI')
    
    args = parser.parse_args()
    
    # Create interface
    interface = DroneRLInterface(uri=args.uri)
    
    # Connect to the simulation
    connected = await interface.connect()
    if not connected:
        print("Failed to connect to the simulation. Exiting.")
        return
    
    # Start receiving messages in the background
    receive_task = asyncio.create_task(interface.receive_messages())
    
    try:
        # Train the agent
        rewards = await interface.train(episodes=args.episodes, steps_per_episode=args.steps)
        
        # Save results
        interface.save_training_results()
        
        print("Training completed successfully")
        
    except KeyboardInterrupt:
        print("Training interrupted by user")
    except Exception as e:
        print(f"Error during training: {e}")
    finally:
        # Clean up
        receive_task.cancel()
        await interface.disconnect()
        plt.close('all')

if __name__ == "__main__":
    asyncio.run(main()) 