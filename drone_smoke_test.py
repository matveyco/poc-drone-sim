#!/usr/bin/env python3
import asyncio
import json
import time
import websockets
import argparse
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('drone-test')

class DroneTest:
    """Simple test for drone control via WebSocket connection."""
    
    def __init__(self, uri="ws://localhost:8765"):
        self.uri = uri
        self.websocket = None
        self.connected = False
        self.drone_state = None
        self.is_flying = False
    
    async def connect(self):
        """Connect to the WebSocket server."""
        try:
            logger.info(f"Connecting to WebSocket server at {self.uri}...")
            self.websocket = await websockets.connect(self.uri)
            self.connected = True
            logger.info("✅ Connected to WebSocket server")
            return True
        except Exception as e:
            logger.error(f"❌ Connection failed: {e}")
            return False
    
    async def disconnect(self):
        """Disconnect from the WebSocket server."""
        if self.websocket:
            await self.websocket.close()
            self.connected = False
            logger.info("Disconnected from WebSocket server")
    
    async def receive_messages(self):
        """Continuously receive and process messages from the server."""
        if not self.connected:
            logger.error("Cannot receive messages: Not connected")
            return
        
        try:
            async for message in self.websocket:
                try:
                    data = json.loads(message)
                    msg_type = data.get('type', 'unknown')
                    
                    if msg_type == 'state':
                        # Update drone state
                        self.drone_state = data
                        # Log position every second
                        pos = data.get('position', {})
                        if time.time() % 1 < 0.1:  # Log approximately once per second
                            logger.info(f"Drone position: x={pos.get('x', 0):.2f}, y={pos.get('y', 0):.2f}, z={pos.get('z', 0):.2f}")
                    
                    elif msg_type == 'config_ack':
                        logger.info(f"Configuration acknowledged: {data.get('settings', {})}")
                    
                    elif msg_type == 'reset_ack':
                        logger.info("Reset acknowledged")
                    
                    else:
                        logger.debug(f"Received message of type: {msg_type}")
                
                except json.JSONDecodeError:
                    logger.warning(f"Received invalid JSON: {message}")
                except Exception as e:
                    logger.error(f"Error processing message: {e}")
        
        except websockets.exceptions.ConnectionClosed:
            logger.warning("WebSocket connection closed")
            self.connected = False
        except Exception as e:
            logger.error(f"Error in receive_messages: {e}")
            self.connected = False
    
    async def send_message(self, message):
        """Send a message to the WebSocket server."""
        if not self.connected:
            logger.error("Cannot send message: Not connected")
            return False
        
        try:
            await self.websocket.send(json.dumps(message))
            return True
        except Exception as e:
            logger.error(f"Error sending message: {e}")
            self.connected = False
            return False
    
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
        
        success = await self.send_message(command)
        if success:
            logger.debug(f"Sent command: thrust={thrust:.2f}, pitch={pitch:.2f}, roll={roll:.2f}, yaw={yaw:.2f}")
        
        return success
    
    async def enable_external_control(self, enable=True):
        """Enable or disable external control of the drone."""
        config = {
            "type": "config",
            "externalControl": enable,
            "timestamp": int(time.time() * 1000)
        }
        
        success = await self.send_message(config)
        if success:
            logger.info(f"External control {'enabled' if enable else 'disabled'}")
        
        return success
    
    async def reset_simulation(self):
        """Reset the drone position."""
        reset_msg = {
            "type": "reset",
            "timestamp": int(time.time() * 1000)
        }
        
        success = await self.send_message(reset_msg)
        if success:
            logger.info("Reset command sent")
        
        return success
    
    async def takeoff(self, target_height=5.0, duration=3.0):
        """Take off to the specified height."""
        logger.info(f"Taking off to height {target_height}m...")
        
        # Gradually increase thrust
        steps = int(duration * 10)  # 10 commands per second
        for i in range(steps):
            progress = i / steps
            # Increase thrust gradually (0.4 to 0.6)
            thrust = 0.4 + progress * 0.2
            await self.send_command(thrust, 0, 0, 0)
            await asyncio.sleep(0.1)
        
        self.is_flying = True
        logger.info("✈️ Takeoff complete")
    
    async def land(self, duration=5.0):
        """Land the drone gently."""
        if not self.is_flying:
            logger.info("Drone is not flying")
            return
        
        logger.info("Landing...")
        
        # Gradually decrease thrust
        steps = int(duration * 10)  # 10 commands per second
        for i in range(steps):
            progress = i / steps
            # Decrease thrust gradually (0.5 to 0.1)
            thrust = 0.5 - progress * 0.4
            await self.send_command(thrust, 0, 0, 0)
            await asyncio.sleep(0.1)
        
        # Final thrust to ensure landing
        await self.send_command(0, 0, 0, 0)
        self.is_flying = False
        logger.info("🛬 Landing complete")
    
    async def hover(self, duration=3.0):
        """Hover in place."""
        logger.info(f"Hovering for {duration} seconds...")
        
        # Send a neutral command for the duration
        start_time = time.time()
        while time.time() - start_time < duration:
            await self.send_command(0.5, 0, 0, 0)  # Thrust of 0.5 to hover
            await asyncio.sleep(0.1)
        
        logger.info("Hover complete")
    
    async def move_forward(self, duration=2.0, intensity=0.3):
        """Move forward."""
        logger.info(f"Moving forward for {duration} seconds...")
        
        # Send forward command for the duration
        start_time = time.time()
        while time.time() - start_time < duration:
            await self.send_command(0.5, -intensity, 0, 0)  # Negative pitch to move forward
            await asyncio.sleep(0.1)
        
        logger.info("Forward movement complete")
    
    async def move_backward(self, duration=2.0, intensity=0.3):
        """Move backward."""
        logger.info(f"Moving backward for {duration} seconds...")
        
        # Send backward command for the duration
        start_time = time.time()
        while time.time() - start_time < duration:
            await self.send_command(0.5, intensity, 0, 0)  # Positive pitch to move backward
            await asyncio.sleep(0.1)
        
        logger.info("Backward movement complete")
    
    async def move_left(self, duration=2.0, intensity=0.3):
        """Move left."""
        logger.info(f"Moving left for {duration} seconds...")
        
        # Send left command for the duration
        start_time = time.time()
        while time.time() - start_time < duration:
            await self.send_command(0.5, 0, -intensity, 0)  # Negative roll to move left
            await asyncio.sleep(0.1)
        
        logger.info("Left movement complete")
    
    async def move_right(self, duration=2.0, intensity=0.3):
        """Move right."""
        logger.info(f"Moving right for {duration} seconds...")
        
        # Send right command for the duration
        start_time = time.time()
        while time.time() - start_time < duration:
            await self.send_command(0.5, 0, intensity, 0)  # Positive roll to move right
            await asyncio.sleep(0.1)
        
        logger.info("Right movement complete")
    
    async def rotate_left(self, duration=2.0, intensity=0.3):
        """Rotate left (counter-clockwise)."""
        logger.info(f"Rotating left for {duration} seconds...")
        
        # Send rotate left command for the duration
        start_time = time.time()
        while time.time() - start_time < duration:
            await self.send_command(0.5, 0, 0, -intensity)  # Negative yaw to rotate left
            await asyncio.sleep(0.1)
        
        logger.info("Left rotation complete")
    
    async def rotate_right(self, duration=2.0, intensity=0.3):
        """Rotate right (clockwise)."""
        logger.info(f"Rotating right for {duration} seconds...")
        
        # Send rotate right command for the duration
        start_time = time.time()
        while time.time() - start_time < duration:
            await self.send_command(0.5, 0, 0, intensity)  # Positive yaw to rotate right
            await asyncio.sleep(0.1)
        
        logger.info("Right rotation complete")
    
    async def fly_square(self, side_duration=2.0, intensity=0.3):
        """Fly in a square pattern."""
        logger.info("Flying in a square pattern...")
        
        # Forward
        await self.move_forward(side_duration, intensity)
        await self.hover(1.0)
        
        # Right
        await self.move_right(side_duration, intensity)
        await self.hover(1.0)
        
        # Backward
        await self.move_backward(side_duration, intensity)
        await self.hover(1.0)
        
        # Left
        await self.move_left(side_duration, intensity)
        await self.hover(1.0)
        
        logger.info("Square pattern complete")
    
    async def run_test_sequence(self):
        """Run a predefined test sequence."""
        logger.info("Starting test sequence")
        
        # Enable external control
        await self.enable_external_control(True)
        
        # Reset drone position
        await self.reset_simulation()
        await asyncio.sleep(1.0)
        
        # Take off
        await self.takeoff(5.0, 3.0)
        await self.hover(2.0)
        
        # Move in different directions
        await self.move_forward(1.5, 0.3)
        await self.hover(1.0)
        
        await self.move_backward(1.5, 0.3)
        await self.hover(1.0)
        
        await self.move_left(1.5, 0.3)
        await self.hover(1.0)
        
        await self.move_right(1.5, 0.3)
        await self.hover(1.0)
        
        # Rotate
        await self.rotate_left(2.0, 0.2)
        await self.hover(1.0)
        
        await self.rotate_right(2.0, 0.2)
        await self.hover(1.0)
        
        # Fly in a square pattern
        await self.fly_square(1.5, 0.25)
        
        # Land
        await self.land(3.0)
        
        # Disable external control
        await self.enable_external_control(False)
        
        logger.info("✅ Test sequence completed successfully!")

async def main():
    parser = argparse.ArgumentParser(description='Drone Control Smoke Test')
    parser.add_argument('--uri', type=str, default='ws://localhost:8765',
                        help='WebSocket URI for the drone server')
    args = parser.parse_args()
    
    # Initialize drone test
    drone_test = DroneTest(uri=args.uri)
    
    # Connect to server
    connected = await drone_test.connect()
    if not connected:
        logger.error("Failed to connect to the WebSocket server. Exiting.")
        return
    
    # Start receiving messages in the background
    receive_task = asyncio.create_task(drone_test.receive_messages())
    
    try:
        # Run test sequence
        await drone_test.run_test_sequence()
    except KeyboardInterrupt:
        logger.info("Test interrupted by user")
    except Exception as e:
        logger.error(f"Error during test: {e}")
    finally:
        # Clean up and disconnect
        receive_task.cancel()
        await drone_test.disconnect()

if __name__ == "__main__":
    asyncio.run(main()) 