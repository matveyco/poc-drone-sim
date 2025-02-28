#!/usr/bin/env python3
import asyncio
import json
import time
import numpy as np
import websockets
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation

class DroneVisualizer:
    """Real-time visualizer for drone simulation data."""
    
    def __init__(self, uri="ws://localhost:8765"):
        self.uri = uri
        self.websocket = None
        self.connected = False
        self.state_history = []
        self.max_history = 500  # Maximum points to keep in history
        
        # Create plots
        self.create_plots()
    
    async def connect(self):
        """Connect to the drone simulation WebSocket server."""
        try:
            self.websocket = await websockets.connect(self.uri)
            self.connected = True
            print(f"Connected to simulation at {self.uri}")
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
    
    def create_plots(self):
        """Create the visualization plots."""
        plt.ion()  # Enable interactive mode
        
        self.fig = plt.figure(figsize=(15, 10))
        self.fig.suptitle('Drone Simulation Visualization', fontsize=16)
        
        # Position plot
        self.ax1 = self.fig.add_subplot(2, 3, 1)
        self.ax1.set_title('Position')
        self.ax1.set_xlabel('Time')
        self.ax1.set_ylabel('Position (m)')
        self.pos_lines = [
            self.ax1.plot([], [], label=axis)[0]
            for axis in ['X', 'Y', 'Z']
        ]
        self.ax1.legend()
        
        # Rotation plot
        self.ax2 = self.fig.add_subplot(2, 3, 2)
        self.ax2.set_title('Rotation')
        self.ax2.set_xlabel('Time')
        self.ax2.set_ylabel('Angle (deg)')
        self.rot_lines = [
            self.ax2.plot([], [], label=axis)[0]
            for axis in ['Pitch', 'Roll', 'Yaw']
        ]
        self.ax2.legend()
        
        # Velocity plot
        self.ax3 = self.fig.add_subplot(2, 3, 3)
        self.ax3.set_title('Velocity')
        self.ax3.set_xlabel('Time')
        self.ax3.set_ylabel('Velocity (m/s)')
        self.vel_lines = [
            self.ax3.plot([], [], label=axis)[0]
            for axis in ['X', 'Y', 'Z']
        ]
        self.ax3.legend()
        
        # Control inputs plot
        self.ax4 = self.fig.add_subplot(2, 3, 4)
        self.ax4.set_title('Control Inputs')
        self.ax4.set_xlabel('Time')
        self.ax4.set_ylabel('Control Value')
        self.control_lines = [
            self.ax4.plot([], [], label=control)[0]
            for control in ['Thrust', 'Pitch', 'Roll', 'Yaw']
        ]
        self.ax4.legend()
        
        # 3D trajectory plot
        self.ax5 = self.fig.add_subplot(2, 3, 5, projection='3d')
        self.ax5.set_title('3D Trajectory')
        self.ax5.set_xlabel('X (m)')
        self.ax5.set_ylabel('Y (m)')
        self.ax5.set_zlabel('Z (m)')
        self.trajectory, = self.ax5.plot([], [], [], 'r-')
        
        # Height vs time plot
        self.ax6 = self.fig.add_subplot(2, 3, 6)
        self.ax6.set_title('Height')
        self.ax6.set_xlabel('Time')
        self.ax6.set_ylabel('Height (m)')
        self.height_line, = self.ax6.plot([], [], 'g-')
        
        plt.tight_layout()
        plt.subplots_adjust(top=0.9)
        self.fig.canvas.draw()
    
    def update_plots(self):
        """Update all plots with the latest data."""
        if len(self.state_history) < 2:
            return
        
        # Get time index for x-axis
        times = list(range(len(self.state_history)))
        
        # Update position plot
        pos_x = [state["position"]["x"] for state in self.state_history]
        pos_y = [state["position"]["y"] for state in self.state_history]
        pos_z = [state["position"]["z"] for state in self.state_history]
        
        self.pos_lines[0].set_data(times, pos_x)
        self.pos_lines[1].set_data(times, pos_y)
        self.pos_lines[2].set_data(times, pos_z)
        self.ax1.relim()
        self.ax1.autoscale_view()
        
        # Update rotation plot
        rot_x = [state["rotation"]["x"] for state in self.state_history]
        rot_y = [state["rotation"]["y"] for state in self.state_history]
        rot_z = [state["rotation"]["z"] for state in self.state_history]
        
        self.rot_lines[0].set_data(times, rot_x)
        self.rot_lines[1].set_data(times, rot_y)
        self.rot_lines[2].set_data(times, rot_z)
        self.ax2.relim()
        self.ax2.autoscale_view()
        
        # Update velocity plot
        vel_x = [state["velocity"]["x"] for state in self.state_history]
        vel_y = [state["velocity"]["y"] for state in self.state_history]
        vel_z = [state["velocity"]["z"] for state in self.state_history]
        
        self.vel_lines[0].set_data(times, vel_x)
        self.vel_lines[1].set_data(times, vel_y)
        self.vel_lines[2].set_data(times, vel_z)
        self.ax3.relim()
        self.ax3.autoscale_view()
        
        # Update control inputs plot
        thrust = [state["controls"]["thrust"] for state in self.state_history]
        pitch = [state["controls"]["pitch"] for state in self.state_history]
        roll = [state["controls"]["roll"] for state in self.state_history]
        yaw = [state["controls"]["yaw"] for state in self.state_history]
        
        self.control_lines[0].set_data(times, thrust)
        self.control_lines[1].set_data(times, pitch)
        self.control_lines[2].set_data(times, roll)
        self.control_lines[3].set_data(times, yaw)
        self.ax4.relim()
        self.ax4.autoscale_view()
        
        # Update 3D trajectory plot
        self.trajectory.set_data(pos_x, pos_z)  # XZ plane
        self.trajectory.set_3d_properties(pos_y)  # Y axis
        self.ax5.relim()
        self.ax5.autoscale_view()
        
        # Update height plot
        heights = [state["height"] if "height" in state else state["position"]["y"] 
                  for state in self.state_history]
        self.height_line.set_data(times, heights)
        self.ax6.relim()
        self.ax6.autoscale_view()
        
        # Update the figure
        self.fig.canvas.draw_idle()
        self.fig.canvas.flush_events()
    
    async def receive_messages(self):
        """Continuously receive and process messages from the server."""
        if not self.connected or not self.websocket:
            print("Not connected to server")
            return
        
        update_interval = 0.1  # Update plots every 100ms
        last_update = time.time()
        
        try:
            while self.connected:
                message = await self.websocket.recv()
                
                try:
                    data = json.loads(message)
                    
                    if data["type"] == "state":
                        # Store state
                        self.state_history.append(data)
                        
                        # Limit history size
                        if len(self.state_history) > self.max_history:
                            self.state_history = self.state_history[-self.max_history:]
                        
                        # Update plots periodically
                        current_time = time.time()
                        if current_time - last_update > update_interval:
                            self.update_plots()
                            last_update = current_time
                
                except json.JSONDecodeError:
                    print(f"Invalid JSON: {message}")
                except Exception as e:
                    print(f"Error processing message: {e}")
        
        except websockets.exceptions.ConnectionClosed:
            print("Connection closed")
            self.connected = False
        except Exception as e:
            print(f"Error receiving messages: {e}")
            self.connected = False
    
    async def run_visualization(self):
        """Run the visualization."""
        print("Starting visualization. Press Ctrl+C to exit.")
        
        # Keep running until interrupted
        try:
            while True:
                await asyncio.sleep(0.1)
        except KeyboardInterrupt:
            print("Visualization stopped by user")

async def main():
    """Main function to run the visualizer."""
    import argparse
    
    parser = argparse.ArgumentParser(description='Visualize drone simulation data')
    parser.add_argument('--uri', type=str, default='ws://localhost:8765', 
                        help='WebSocket URI for the simulation')
    
    args = parser.parse_args()
    
    visualizer = DroneVisualizer(uri=args.uri)
    
    # Connect to the simulation
    connected = await visualizer.connect()
    if not connected:
        print("Failed to connect to the simulation. Exiting.")
        return
    
    # Start receiving messages in the background
    receive_task = asyncio.create_task(visualizer.receive_messages())
    
    try:
        # Run visualization
        await visualizer.run_visualization()
    finally:
        # Clean up
        receive_task.cancel()
        await visualizer.disconnect()

if __name__ == "__main__":
    plt.style.use('dark_background')  # Use dark theme for better visibility
    asyncio.run(main()) 