#!/usr/bin/env python3
import asyncio
import json
import time
import os
import numpy as np
import websockets
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation

# For TensorFlow with GPU
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'
import tensorflow as tf

# For PyTorch with GPU
import torch

class DroneSimulationInterface:
    """Interface for connecting to the drone simulation via WebSocket."""
    
    def __init__(self, uri="ws://localhost:8765"):
        self.uri = uri
        self.websocket = None
        self.connected = False
        self.state_history = []
        self.drone_state = None
        self.last_command_time = 0
        self.command_interval = 0.05  # 20Hz control rate
        self.visualize = True
        
        # Initialize neural network model
        self.model = self.create_model()
        
        # Initialize visualization if enabled
        if self.visualize:
            self.init_visualization()
    
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
    
    async def send_command(self, thrust, pitch, roll, yaw):
        """Send control commands to the drone."""
        current_time = time.time()
        
        # Rate limiting
        if current_time - self.last_command_time < self.command_interval:
            return
        
        self.last_command_time = current_time
        
        command = {
            "type": "control",
            "thrust": float(thrust),
            "pitch": float(pitch),
            "roll": float(roll),
            "yaw": float(yaw),
            "timestamp": int(current_time * 1000)
        }
        
        await self.send_message(command)
    
    async def reset_simulation(self, position=None):
        """Reset the drone to initial position."""
        reset_msg = {
            "type": "reset",
            "timestamp": int(time.time() * 1000)
        }
        
        if position:
            reset_msg["position"] = position
        
        await self.send_message(reset_msg)
        print("Reset command sent")
    
    async def send_config(self, enable_external_control):
        """Configure the simulation."""
        config = {
            "type": "config",
            "externalControl": enable_external_control,
            "timestamp": int(time.time() * 1000)
        }
        
        await self.send_message(config)
        print(f"External control {'enabled' if enable_external_control else 'disabled'}")
    
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
    
    async def receive_messages(self):
        """Continuously receive and process messages from the server."""
        if not self.connected or not self.websocket:
            print("Not connected to server")
            return
        
        try:
            while self.connected:
                message = await self.websocket.recv()
                await self.process_message(message)
        except websockets.exceptions.ConnectionClosed:
            print("Connection closed")
            self.connected = False
        except Exception as e:
            print(f"Error receiving messages: {e}")
            self.connected = False
    
    async def process_message(self, message):
        """Process incoming messages from the server."""
        try:
            data = json.loads(message)
            
            if data["type"] == "state":
                self.drone_state = data
                self.state_history.append(data)
                
                # Limit history size
                if len(self.state_history) > 1000:
                    self.state_history = self.state_history[-1000:]
                
                # Update visualization
                if self.visualize:
                    self.update_visualization()
                
                # Use neural network for control if active
                if hasattr(self, 'training_mode') and self.training_mode:
                    control_outputs = self.predict_control(data)
                    await self.send_command(*control_outputs)
            
            elif data["type"] == "config_ack":
                print(f"Configuration acknowledged: {data['settings']}")
            
            elif data["type"] == "reset_ack":
                print("Reset acknowledged")
                self.state_history = []
            
            elif data["type"] == "pong":
                latency = time.time() * 1000 - data["timestamp"]
                print(f"Ping: {latency:.2f}ms")
        
        except json.JSONDecodeError:
            print(f"Invalid JSON: {message}")
        except Exception as e:
            print(f"Error processing message: {e}")
    
    def create_model(self):
        """Create a neural network model for drone control."""
        # Using TensorFlow
        model = tf.keras.Sequential([
            tf.keras.layers.Dense(64, activation='relu', input_shape=(12,)),
            tf.keras.layers.Dense(32, activation='relu'),
            tf.keras.layers.Dense(4, activation='tanh')  # thrust, pitch, roll, yaw
        ])
        
        model.compile(
            optimizer=tf.keras.optimizers.Adam(0.001),
            loss='mse'
        )
        
        print("Neural network model created")
        return model
    
    def predict_control(self, state):
        """Use the neural network to predict control values."""
        if not hasattr(self, 'model') or self.model is None:
            return (0, 0, 0, 0)
        
        # Extract features from state
        features = self.extract_features(state)
        
        # Make prediction
        inputs = np.array([features])
        outputs = self.model.predict(inputs, verbose=0)[0]
        
        # Scale outputs appropriately for the drone
        thrust = (outputs[0] + 1) * 0.5  # 0 to 1
        pitch = outputs[1]  # -1 to 1
        roll = outputs[2]   # -1 to 1
        yaw = outputs[3]    # -1 to 1
        
        return (thrust, pitch, roll, yaw)
    
    def extract_features(self, state):
        """Extract relevant features from drone state for the neural network."""
        # Position, rotation, velocity
        features = [
            state["position"]["x"],
            state["position"]["y"],
            state["position"]["z"],
            state["rotation"]["x"],
            state["rotation"]["y"],
            state["rotation"]["z"],
            state["velocity"]["x"],
            state["velocity"]["y"],
            state["velocity"]["z"],
            state["angularVelocity"]["x"],
            state["angularVelocity"]["y"],
            state["angularVelocity"]["z"]
        ]
        
        return features
    
    def init_visualization(self):
        """Initialize visualization of drone state and learning progress."""
        plt.ion()  # Enable interactive mode
        
        # Create figure with multiple subplots
        self.fig, self.axs = plt.subplots(2, 2, figsize=(12, 8))
        self.fig.suptitle('Drone Simulation Data')
        
        # Position plot
        self.axs[0, 0].set_title('Position')
        self.axs[0, 0].set_xlabel('Time')
        self.axs[0, 0].set_ylabel('Position (m)')
        self.pos_lines = [
            self.axs[0, 0].plot([], [], label=axis)[0]
            for axis in ['X', 'Y', 'Z']
        ]
        self.axs[0, 0].legend()
        
        # Rotation plot
        self.axs[0, 1].set_title('Rotation')
        self.axs[0, 1].set_xlabel('Time')
        self.axs[0, 1].set_ylabel('Angle (deg)')
        self.rot_lines = [
            self.axs[0, 1].plot([], [], label=axis)[0]
            for axis in ['Pitch', 'Roll', 'Yaw']
        ]
        self.axs[0, 1].legend()
        
        # Control plot
        self.axs[1, 0].set_title('Control Inputs')
        self.axs[1, 0].set_xlabel('Time')
        self.axs[1, 0].set_ylabel('Control Value')
        self.control_lines = [
            self.axs[1, 0].plot([], [], label=control)[0]
            for control in ['Thrust', 'Pitch', 'Roll', 'Yaw']
        ]
        self.axs[1, 0].legend()
        
        # Learning progress plot
        self.axs[1, 1].set_title('Learning Progress')
        self.axs[1, 1].set_xlabel('Episode')
        self.axs[1, 1].set_ylabel('Reward')
        self.reward_line, = self.axs[1, 1].plot([], [])
        
        plt.tight_layout()
        self.fig.canvas.draw()
        self.fig.canvas.flush_events()
    
    def update_visualization(self):
        """Update the visualization with current data."""
        if not hasattr(self, 'fig') or not plt.fignum_exists(self.fig.number):
            return
        
        # Extract data from history
        if len(self.state_history) < 2:
            return
        
        # Get last 100 states for plotting
        history = self.state_history[-100:]
        timestamps = list(range(len(history)))
        
        # Update position plot
        pos_x = [state["position"]["x"] for state in history]
        pos_y = [state["position"]["y"] for state in history]
        pos_z = [state["position"]["z"] for state in history]
        
        self.pos_lines[0].set_data(timestamps, pos_x)
        self.pos_lines[1].set_data(timestamps, pos_y)
        self.pos_lines[2].set_data(timestamps, pos_z)
        
        self.axs[0, 0].relim()
        self.axs[0, 0].autoscale_view()
        
        # Update rotation plot
        rot_x = [state["rotation"]["x"] for state in history]
        rot_y = [state["rotation"]["y"] for state in history]
        rot_z = [state["rotation"]["z"] for state in history]
        
        self.rot_lines[0].set_data(timestamps, rot_x)
        self.rot_lines[1].set_data(timestamps, rot_y)
        self.rot_lines[2].set_data(timestamps, rot_z)
        
        self.axs[0, 1].relim()
        self.axs[0, 1].autoscale_view()
        
        # Update control plot
        thrust = [state["controls"]["thrust"] for state in history]
        pitch = [state["controls"]["pitch"] for state in history]
        roll = [state["controls"]["roll"] for state in history]
        yaw = [state["controls"]["yaw"] for state in history]
        
        self.control_lines[0].set_data(timestamps, thrust)
        self.control_lines[1].set_data(timestamps, pitch)
        self.control_lines[2].set_data(timestamps, roll)
        self.control_lines[3].set_data(timestamps, yaw)
        
        self.axs[1, 0].relim()
        self.axs[1, 0].autoscale_view()
        
        # Update the figure
        self.fig.canvas.draw_idle()
        self.fig.canvas.flush_events()
    
    def update_reward_plot(self, episodes, rewards):
        """Update the reward plot with learning progress."""
        if not hasattr(self, 'fig') or not plt.fignum_exists(self.fig.number):
            return
        
        self.reward_line.set_data(episodes, rewards)
        self.axs[1, 1].relim()
        self.axs[1, 1].autoscale_view()
        
        self.fig.canvas.draw_idle()
        self.fig.canvas.flush_events()
    
    def save_model(self, filename="drone_model"):
        """Save the trained model."""
        if not hasattr(self, 'model') or self.model is None:
            print("No model to save")
            return False
        
        try:
            self.model.save(f"{filename}.h5")
            print(f"Model saved as {filename}.h5")
            return True
        except Exception as e:
            print(f"Error saving model: {e}")
            return False
    
    def load_model(self, filename="drone_model"):
        """Load a trained model."""
        try:
            self.model = tf.keras.models.load_model(f"{filename}.h5")
            print(f"Model loaded from {filename}.h5")
            return True
        except Exception as e:
            print(f"Error loading model: {e}")
            return False
    
    def calculate_reward(self, state):
        """Calculate reward based on drone state."""
        if not state:
            return 0
        
        # Extract relevant state variables
        height = state["position"]["y"]
        target_height = 5.0
        
        pitch = state["rotation"]["x"]
        roll = state["rotation"]["z"]
        
        # Penalize deviation from target height
        height_reward = np.exp(-np.abs(height - target_height) / 2)
        
        # Penalize excessive tilt
        stability_reward = np.exp(-(np.abs(pitch) + np.abs(roll)) / 30)
        
        # Combined reward
        reward = height_reward * 0.6 + stability_reward * 0.4
        
        return reward

async def main():
    """Main function to run the drone control interface."""
    interface = DroneSimulationInterface()
    
    # Connect to the simulation
    connected = await interface.connect()
    if not connected:
        print("Failed to connect to the simulation. Exiting.")
        return
    
    # Start receiving messages in the background
    receive_task = asyncio.create_task(interface.receive_messages())
    
    try:
        # Reset the simulation to start fresh
        await interface.reset_simulation()
        await asyncio.sleep(1)  # Wait for reset to complete
        
        # Run training loop
        await train_drone(interface)
        
    except KeyboardInterrupt:
        print("Interrupted by user")
    finally:
        # Clean up
        receive_task.cancel()
        await interface.disconnect()

async def train_drone(interface):
    """Train the drone control neural network."""
    interface.training_mode = True
    episodes = 10
    steps_per_episode = 1000
    
    all_rewards = []
    episode_nums = []
    
    print(f"Starting training for {episodes} episodes")
    
    for episode in range(episodes):
        print(f"Episode {episode+1}/{episodes}")
        
        # Reset simulation at the start of each episode
        await interface.reset_simulation()
        await asyncio.sleep(1)  # Wait for reset
        
        episode_rewards = []
        
        # Run episode
        for step in range(steps_per_episode):
            # Get current state
            if interface.drone_state is None:
                await asyncio.sleep(0.05)
                continue
            
            # Use neural network to predict control
            controls = interface.predict_control(interface.drone_state)
            
            # Send control commands
            await interface.send_command(*controls)
            
            # Calculate reward
            reward = interface.calculate_reward(interface.drone_state)
            episode_rewards.append(reward)
            
            # Collect training data
            if step % 10 == 0:
                print(f"Step {step}: Reward = {reward:.4f}")
            
            await asyncio.sleep(0.05)  # Control rate
        
        # Episode complete
        avg_reward = sum(episode_rewards) / len(episode_rewards)
        all_rewards.append(avg_reward)
        episode_nums.append(episode + 1)
        
        print(f"Episode {episode+1} complete. Average reward: {avg_reward:.4f}")
        
        # Update progress visualization
        interface.update_reward_plot(episode_nums, all_rewards)
        
        # Train the model with collected data
        print("Training model...")
        # This would be where we actually train the model with the collected data
        # interface.train_model(collected_states, collected_actions, collected_rewards)
        
        # Save model periodically
        if (episode + 1) % 5 == 0 or episode == episodes - 1:
            interface.save_model(f"drone_model_episode_{episode+1}")
    
    print("Training complete")
    interface.training_mode = False

if __name__ == "__main__":
    asyncio.run(main()) 