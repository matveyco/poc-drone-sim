#!/usr/bin/env python3
import asyncio
import json
import argparse
import logging
import sys
import websockets

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(stream=sys.stdout)]
)
logger = logging.getLogger('drone-server')

# Store connected clients
connected_clients = set()

# Store drone state
drone_state = None

async def handle_client(websocket):
    """Handle a WebSocket client connection."""
    global drone_state
    
    # Register the client
    connected_clients.add(websocket)
    client_id = id(websocket)
    logger.info(f"Client {client_id} connected. Total clients: {len(connected_clients)}")
    
    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                logger.info(f"Received message: {data.get('type')}")
                
                # Handle state updates from the simulation
                if data.get('type') == 'state':
                    # Update stored state
                    drone_state = data
                    
                    # Broadcast state to all connected clients except the sender
                    await broadcast_message(websocket, message)
                
                # Handle other message types
                elif data.get('type') == 'control':
                    # Just forward control messages to all clients
                    await broadcast_message(websocket, message)
                    logger.debug(f"Control message: thrust={data.get('thrust', 0):.2f}, "
                                f"pitch={data.get('pitch', 0):.2f}, "
                                f"roll={data.get('roll', 0):.2f}, "
                                f"yaw={data.get('yaw', 0):.2f}")
                
                elif data.get('type') == 'config':
                    # Forward configuration messages
                    await broadcast_message(websocket, message)
                    logger.info(f"Configuration update: {data}")
                
                elif data.get('type') == 'reset':
                    # Forward reset messages
                    await broadcast_message(websocket, message)
                    logger.info("Reset command received")
                
                else:
                    # Log unknown message types
                    logger.warning(f"Unknown message type: {data.get('type')}")
                
            except json.JSONDecodeError:
                logger.error(f"Invalid JSON: {message}")
            except Exception as e:
                logger.error(f"Error processing message: {e}")
    
    except websockets.exceptions.ConnectionClosed as e:
        logger.info(f"Client {client_id} disconnected: code={getattr(e, 'code', 'unknown')} reason={getattr(e, 'reason', 'unknown')}")
    except Exception as e:
        logger.error(f"Error handling client {client_id}: {e}")
    finally:
        # Unregister the client
        if websocket in connected_clients:
            connected_clients.remove(websocket)
        logger.info(f"Client {client_id} removed. Total clients: {len(connected_clients)}")

async def broadcast_message(sender, message):
    """Broadcast a message to all connected clients except the sender."""
    for client in connected_clients:
        if client != sender:  # Don't send back to the sender
            try:
                await client.send(message)
            except websockets.exceptions.ConnectionClosed:
                # Client is closed but not yet removed
                pass
            except Exception as e:
                logger.error(f"Error broadcasting to client: {e}")

async def start_server(host='localhost', port=8765):
    """Start the WebSocket server."""
    async with websockets.serve(handle_client, host, port):
        logger.info(f"Drone WebSocket server running at ws://{host}:{port}")
        logger.info("Press Ctrl+C to stop")
        # Keep the server running until interrupted
        await asyncio.Future()  # This will run forever until cancelled

def main():
    parser = argparse.ArgumentParser(description='WebSocket server for drone simulation')
    parser.add_argument('--host', type=str, default='localhost',
                        help='Host to bind the server to')
    parser.add_argument('--port', type=int, default=8765,
                        help='Port to bind the server to')
    parser.add_argument('--debug', action='store_true',
                        help='Enable debug logging')
    
    args = parser.parse_args()
    
    if args.debug:
        logger.setLevel(logging.DEBUG)
    
    # Explicitly get and set the event loop
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    try:
        # Run the server in the event loop
        loop.run_until_complete(start_server(args.host, args.port))
    except KeyboardInterrupt:
        logger.info("Server stopped by user")
    except Exception as e:
        logger.error(f"Server error: {e}")
    finally:
        # Clean up the loop
        loop.close()

if __name__ == "__main__":
    main() 