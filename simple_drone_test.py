#!/usr/bin/env python3
import asyncio
import json
import time
import websockets
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('drone-test')

async def main():
    # Connect to WebSocket server
    uri = "ws://localhost:8765"
    logger.info(f"Connecting to {uri}")
    
    try:
        async with websockets.connect(uri) as websocket:
            logger.info("Connected to WebSocket server")
            
            # Enable external control
            logger.info("Enabling external control")
            await websocket.send(json.dumps({
                "type": "config",
                "externalControl": True,
                "timestamp": time.time() * 1000
            }))
            
            # Reset position
            logger.info("Resetting drone position")
            await websocket.send(json.dumps({
                "type": "reset",
                "timestamp": time.time() * 1000
            }))
            await asyncio.sleep(1)
            
            # Take off (gradual thrust increase)
            logger.info("Taking off")
            for i in range(30):  # 3 seconds
                thrust = 0.5 + (i / 30) * 0.3  # 0.5 to 0.8
                await websocket.send(json.dumps({
                    "type": "control",
                    "thrust": thrust,
                    "pitch": 0.0,
                    "roll": 0.0,
                    "yaw": 0.0,
                    "timestamp": time.time() * 1000
                }))
                await asyncio.sleep(0.1)
            
            # Hover for 2 seconds
            logger.info("Hovering")
            for i in range(20):  # 2 seconds
                await websocket.send(json.dumps({
                    "type": "control",
                    "thrust": 0.7,
                    "pitch": 0.0,
                    "roll": 0.0,
                    "yaw": 0.0,
                    "timestamp": time.time() * 1000
                }))
                await asyncio.sleep(0.1)
            
            # Move forward
            logger.info("Moving forward")
            for i in range(20):  # 2 seconds
                await websocket.send(json.dumps({
                    "type": "control",
                    "thrust": 0.7,
                    "pitch": -0.5,  # Forward in most drone systems
                    "roll": 0.0,
                    "yaw": 0.0,
                    "timestamp": time.time() * 1000
                }))
                await asyncio.sleep(0.1)
            
            # Hover for 1 second
            logger.info("Hovering")
            for i in range(10):  # 1 second
                await websocket.send(json.dumps({
                    "type": "control",
                    "thrust": 0.7,
                    "pitch": 0.0,
                    "roll": 0.0,
                    "yaw": 0.0,
                    "timestamp": time.time() * 1000
                }))
                await asyncio.sleep(0.1)
            
            # Land (gradual thrust decrease)
            logger.info("Landing")
            for i in range(30):  # 3 seconds
                thrust = 0.7 - (i / 30) * 0.6  # 0.7 to 0.1
                await websocket.send(json.dumps({
                    "type": "control",
                    "thrust": thrust,
                    "pitch": 0.0,
                    "roll": 0.0,
                    "yaw": 0.0,
                    "timestamp": time.time() * 1000
                }))
                await asyncio.sleep(0.1)
            
            # Disable external control
            logger.info("Disabling external control")
            await websocket.send(json.dumps({
                "type": "config",
                "externalControl": False,
                "timestamp": time.time() * 1000
            }))
            
            logger.info("Test completed successfully")
    
    except websockets.exceptions.ConnectionClosed:
        logger.error("WebSocket connection closed unexpectedly")
    except Exception as e:
        logger.error(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(main()) 