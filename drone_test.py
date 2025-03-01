#!/usr/bin/env python3
import asyncio
import json
import time
import numpy as np
import websockets
import tensorflow as tf
import argparse

class DroneTestInterface:
    """Interface for testing trained drone control models."""
    
    def __init__(self, model_path, uri="ws://localhost:8765"):
        self.uri = uri
        self.websocket = None
        self.connected = False
        self.drone_state = None
        self.model_path = model_path
        self.model = None
        
        # Load the model
        self.load_model()
    
    def load_model(self):
        """Load the trained TensorFlow model."""
        try:
            self.model = tf.keras.models.load_model(self.model_path)
            print(f"Successfully loaded model from {self.model_path}")
        except Exception as e:
            print(f"Failed to load model: {e}")
    
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
        command = {
            "type": "control",
            "thrust": float(thrust),
            "pitch": float(pitch),
            "roll": float(roll),
            "yaw": float(yaw),
            "timestamp": int(time.time() * 1000)
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
                # Store the drone state
                self.drone_state = data
                
                # Use neural network for control
                if self.model:
                    control_outputs = self.predict_control(data)
                    await self.send_command(*control_outputs)
            
            elif data["type"] == "config_ack":
                print(f"Configuration acknowledged: {data['settings']}")
            
            elif data["type"] == "reset_ack":
                print("Reset acknowledged")
            
        except json.JSONDecodeError:
            print(f"Invalid JSON: {message}")
        except Exception as e:
            print(f"Error processing message: {e}")
    
    def extract_features(self, state):
        """Extract relevant features from drone state for the neural network."""
        return np.array([[
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
        ]])
    
    def predict_control(self, state):
        """Use the neural network to predict control values."""
        if not self.model:
            return (0.5, 0, 0, 0)  # Default hover command
        
        # Extract features
        features = self.extract_features(state)
        
        # Get prediction
        control_values = self.model.predict(features, verbose=0)[0]
        
        # Scale outputs for drone control
        thrust = (control_values[0] + 1) / 2  # Scale to 0-1
        pitch = control_values[1]             # -1 to 1
        roll = control_values[2]              # -1 to 1
        yaw = control_values[3]               # -1 to 1
        
        # Print control values for debugging
        print(f"Control: thrust={thrust:.2f}, pitch={pitch:.2f}, roll={roll:.2f}, yaw={yaw:.2f}")
        
        return thrust, pitch, roll, yaw
    
    async def run_test(self, duration=60):
        """Run test of the trained model."""
        if not self.model:
            print("No model loaded. Cannot run test.")
            return
        
        print(f"Running test for {duration} seconds")
        
        # Reset simulation
        await self.reset_simulation()
        await asyncio.sleep(1)  # Wait for reset
        
        # Run for specified duration
        start_time = time.time()
        while time.time() - start_time < duration:
            if not self.connected:
                print("Connection lost. Stopping test.")
                return
            
            await asyncio.sleep(0.1)  # Control rate limiter
        
        print("Test complete")

async def main():
    """Main function to run the test interface."""
    parser = argparse.ArgumentParser(description='Test a trained drone control model')
    parser.add_argument('--model', type=str, required=True, help='Path to the trained model')
    parser.add_argument('--duration', type=int, default=60, help='Test duration in seconds')
    parser.add_argument('--uri', type=str, default='ws://localhost:8765', help='WebSocket URI for the simulation')
    
    args = parser.parse_args()
    
    interface = DroneTestInterface(model_path=args.model, uri=args.uri)
    
    # Connect to the simulation
    connected = await interface.connect()
    if not connected:
        print("Failed to connect to the simulation. Exiting.")
        return
    
    # Start receiving messages in the background
    receive_task = asyncio.create_task(interface.receive_messages())
    
    try:
        # Run the test
        await interface.run_test(duration=args.duration)
        
    except KeyboardInterrupt:
        print("Interrupted by user")
    finally:
        # Clean up
        receive_task.cancel()
        await interface.disconnect()

if __name__ == "__main__":
    asyncio.run(main()) 