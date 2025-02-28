/**
 * DroneWebSocketConnector - A standalone module for connecting a drone to a WebSocket server
 * 
 * This script doesn't use PlayCanvas's script system and can be included directly in your HTML.
 */
(function() {
    // Wait for the page to fully load before trying to access PlayCanvas
    window.addEventListener('load', function() {
        // Wait a bit to ensure PlayCanvas is fully initialized
        setTimeout(initializeWebSocketConnector, 2000);
    });
    
    function initializeWebSocketConnector() {
        console.log("Initializing WebSocket connector...");
        
        // Configuration
        var config = {
            wsUrl: 'ws://localhost:8765',
            autoConnect: true,
            debug: true
        };
        
        // Create UI
        var ui = createUI();
        
        // State
        var socket = null;
        var connected = false;
        var externalControlEnabled = false;
        var droneEntity = null;
        var droneController = null;
        
        // Find the drone entity in the scene
        findDroneEntity();
        
        // Auto-connect if enabled
        if (config.debug) {
            console.log("WebSocket connector initialized.");
            console.log("Auto-connect is " + (config.autoConnect ? "enabled" : "disabled"));
        }
        
        if (config.autoConnect) {
            setTimeout(connect, 1000);
        }
        
        /**
         * Attempt to find the drone entity in the scene
         */
        function findDroneEntity() {
            if (!window.pc || !window.pc.app) {
                if (config.debug) {
                    console.log("PlayCanvas app not found, will retry...");
                }
                setTimeout(findDroneEntity, 1000);
                return;
            }
            
            // Look for entities with likely drone names
            var droneNames = ['Drone', 'drone', 'Quadcopter', 'quadcopter', 'UAV', 'uav'];
            
            for (var i = 0; i < droneNames.length; i++) {
                var entity = window.pc.app.root.findByName(droneNames[i]);
                if (entity) {
                    droneEntity = entity;
                    if (config.debug) {
                        console.log("Found drone entity: " + droneEntity.name);
                    }
                    break;
                }
            }
            
            if (!droneEntity) {
                if (config.debug) {
                    console.log("Drone entity not found with common names.");
                    console.log("You'll need to manually set the drone entity.");
                }
            } else {
                // Try to find the controller script
                if (droneEntity.script) {
                    for (var scriptName in droneEntity.script) {
                        if (scriptName.toLowerCase().includes('controller') || 
                            scriptName.toLowerCase().includes('control')) {
                            droneController = droneEntity.script[scriptName];
                            if (config.debug) {
                                console.log("Found drone controller: " + scriptName);
                            }
                            break;
                        }
                    }
                }
            }
        }
        
        /**
         * Connect to the WebSocket server
         */
        function connect() {
            try {
                log("Connecting to " + config.wsUrl);
                updateStatus("Connecting...");
                
                socket = new WebSocket(config.wsUrl);
                
                socket.onopen = function() {
                    connected = true;
                    log("Connected to WebSocket server");
                    updateStatus("Connected", true);
                };
                
                socket.onclose = function() {
                    connected = false;
                    log("Disconnected from WebSocket server");
                    updateStatus("Disconnected");
                };
                
                socket.onerror = function(error) {
                    log("WebSocket error", true);
                    console.error(error);
                    updateStatus("Error");
                };
                
                socket.onmessage = function(event) {
                    handleMessage(event.data);
                };
            } catch (e) {
                log("Error connecting: " + e, true);
                updateStatus("Connection Failed");
            }
        }
        
        /**
         * Disconnect from the server
         */
        function disconnect() {
            if (socket) {
                socket.close();
                socket = null;
                connected = false;
            }
        }
        
        /**
         * Send drone state to the server
         */
        function sendDroneState() {
            if (!connected || !socket || !droneEntity) return;
            
            // Get position and rotation
            var pos = droneEntity.getPosition();
            var rot = droneEntity.getEulerAngles();
            
            // Create message
            var message = {
                type: 'state',
                position: { x: pos.x, y: pos.y, z: pos.z },
                rotation: { x: rot.x, y: rot.y, z: rot.z },
                timestamp: Date.now()
            };
            
            // Add velocity if available
            if (droneController && droneController.velocity) {
                message.velocity = {
                    x: droneController.velocity.x || 0,
                    y: droneController.velocity.y || 0,
                    z: droneController.velocity.z || 0
                };
            }
            
            sendMessage(message);
        }
        
        /**
         * Enable/disable external control
         */
        function setExternalControl(enabled) {
            externalControlEnabled = enabled;
            
            sendMessage({
                type: 'config',
                externalControl: enabled
            });
            
            log("External control " + (enabled ? "enabled" : "disabled"));
            updateControlToggle();
        }
        
        /**
         * Reset the drone
         */
        function reset() {
            sendMessage({
                type: 'reset'
            });
            
            log("Reset command sent");
            
            // Reset drone locally if possible
            if (droneController && typeof droneController.reset === 'function') {
                droneController.reset();
            }
        }
        
        /**
         * Send a message to the server
         */
        function sendMessage(message) {
            if (!connected || !socket) return;
            
            try {
                socket.send(JSON.stringify(message));
            } catch (e) {
                log("Error sending message: " + e, true);
            }
        }
        
        /**
         * Handle incoming message
         */
        function handleMessage(data) {
            try {
                var message = JSON.parse(data);
                
                // Handle different message types
                if (message.type === 'control' && externalControlEnabled && droneController) {
                    // Apply control to drone
                    // Adjust these properties to match your drone controller
                    if (typeof message.thrust === 'number') {
                        droneController.thrust = message.thrust;
                    }
                    if (typeof message.pitch === 'number') {
                        droneController.pitch = message.pitch;
                    }
                    if (typeof message.roll === 'number') {
                        droneController.roll = message.roll;
                    }
                    if (typeof message.yaw === 'number') {
                        droneController.yaw = message.yaw;
                    }
                    
                    log("Received control: " + 
                        "thrust=" + message.thrust.toFixed(2) + ", " +
                        "pitch=" + message.pitch.toFixed(2) + ", " +
                        "roll=" + message.roll.toFixed(2) + ", " +
                        "yaw=" + message.yaw.toFixed(2));
                }
                else if (message.type === 'config') {
                    if (typeof message.externalControl === 'boolean') {
                        externalControlEnabled = message.externalControl;
                        updateControlToggle();
                        log("External control " + (externalControlEnabled ? "enabled" : "disabled"));
                    }
                }
                else if (message.type === 'reset') {
                    // Reset drone locally if possible
                    if (droneController && typeof droneController.reset === 'function') {
                        droneController.reset();
                        log("Reset received");
                    }
                }
            } catch (e) {
                log("Error parsing message: " + e, true);
            }
        }
        
        /**
         * Create UI elements
         */
        function createUI() {
            // Create container
            var container = document.createElement('div');
            container.style.position = 'absolute';
            container.style.top = '10px';
            container.style.left = '10px';
            container.style.background = 'rgba(0, 0, 0, 0.7)';
            container.style.color = 'white';
            container.style.padding = '10px';
            container.style.borderRadius = '5px';
            container.style.fontFamily = 'Arial, sans-serif';
            container.style.fontSize = '12px';
            container.style.zIndex = '1000';
            
            // Status display
            var statusEl = document.createElement('div');
            statusEl.textContent = 'WebSocket: Not Connected';
            container.appendChild(statusEl);
            
            // Buttons container
            var buttonContainer = document.createElement('div');
            buttonContainer.style.marginTop = '5px';
            buttonContainer.style.display = 'flex';
            buttonContainer.style.gap = '5px';
            
            // Connect button
            var connectBtn = document.createElement('button');
            connectBtn.textContent = 'Connect';
            connectBtn.addEventListener('click', connect);
            buttonContainer.appendChild(connectBtn);
            
            // Disconnect button
            var disconnectBtn = document.createElement('button');
            disconnectBtn.textContent = 'Disconnect';
            disconnectBtn.disabled = true;
            disconnectBtn.addEventListener('click', disconnect);
            buttonContainer.appendChild(disconnectBtn);
            
            // Reset button
            var resetBtn = document.createElement('button');
            resetBtn.textContent = 'Reset';
            resetBtn.disabled = true;
            resetBtn.addEventListener('click', reset);
            buttonContainer.appendChild(resetBtn);
            
            container.appendChild(buttonContainer);
            
            // Control toggle
            var controlToggle = document.createElement('div');
            controlToggle.style.marginTop = '5px';
            
            var controlCheckbox = document.createElement('input');
            controlCheckbox.type = 'checkbox';
            controlCheckbox.id = 'external-control';
            controlCheckbox.disabled = true;
            controlCheckbox.addEventListener('change', function(e) {
                setExternalControl(e.target.checked);
            });
            
            var controlLabel = document.createElement('label');
            controlLabel.htmlFor = 'external-control';
            controlLabel.textContent = ' Enable External Control';
            
            controlToggle.appendChild(controlCheckbox);
            controlToggle.appendChild(controlLabel);
            container.appendChild(controlToggle);
            
            // Add to document
            document.body.appendChild(container);
            
            // Start the update loop to send drone state
            setInterval(function() {
                if (connected && socket) {
                    sendDroneState();
                }
            }, 100);  // Send state 10 times per second
            
            return {
                container: container,
                statusEl: statusEl,
                connectBtn: connectBtn,
                disconnectBtn: disconnectBtn,
                resetBtn: resetBtn,
                controlCheckbox: controlCheckbox
            };
        }
        
        /**
         * Update status display
         */
        function updateStatus(status, isConnected) {
            ui.statusEl.textContent = 'WebSocket: ' + status;
            ui.statusEl.style.color = isConnected ? '#88ff88' : '#ff8888';
            
            ui.connectBtn.disabled = isConnected || status === 'Connecting...';
            ui.disconnectBtn.disabled = !isConnected;
            ui.resetBtn.disabled = !isConnected;
            ui.controlCheckbox.disabled = !isConnected;
        }
        
        /**
         * Update control toggle
         */
        function updateControlToggle() {
            ui.controlCheckbox.checked = externalControlEnabled;
        }
        
        /**
         * Log message
         */
        function log(message, isError) {
            if (config.debug || isError) {
                console.log('[DroneWebSocket] ' + message);
            }
        }
    }
    
    function createUI() {
        // The UI elements will be created once PlayCanvas is initialized
        return {
            statusEl: null,
            connectBtn: null,
            disconnectBtn: null,
            resetBtn: null,
            controlCheckbox: null
        };
    }
})(); 