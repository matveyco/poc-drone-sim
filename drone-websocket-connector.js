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
        var controlProps = {
            valid: false,
            thrust: null,
            pitch: null,
            roll: null,
            yaw: null,
            inputProperties: []
        };
        
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
         * Find the drone entity and controller in the scene
         */
        function findDroneEntity() {
            if (!window.pc || !window.pc.app) {
                if (config.debug) {
                    console.log("PlayCanvas app not found, will retry...");
                }
                setTimeout(findDroneEntity, 1000);
                return;
            }
            
            // First try to find by common drone names
            var droneNames = ['Drone', 'drone', 'Quadcopter', 'quadcopter', 'UAV', 'uav', 'Copter', 'copter'];
            
            for (var i = 0; i < droneNames.length; i++) {
                var entity = window.pc.app.root.findByName(droneNames[i]);
                if (entity) {
                    droneEntity = entity;
                    log("Found drone entity: " + droneEntity.name);
                    break;
                }
            }
            
            // If not found by name, look for entities with rigidbody that might be a drone
            if (!droneEntity) {
                // Walk through all entities to find potential drones
                window.pc.app.root.forEach(function(entity) {
                    // If it has a rigidbody and some typical script, it might be a drone
                    if (entity.rigidbody && entity.script) {
                        droneEntity = entity;
                        log("Found potential drone by rigidbody: " + entity.name);
                        return;
                    }
                });
            }
            
            if (!droneEntity) {
                log("⚠️ Drone entity not found. Please manually set droneEntity in console.", true);
                // Print instructions for manual setup
                console.log("To manually set the drone entity, use the console:");
                console.log("1. Find your drone entity in the scene hierarchy");
                console.log("2. Right-click it and select 'Copy Path'");
                console.log("3. Run this command in console: 'droneEntity = pc.app.root.findByPath(\"path/to/drone\")'");
                
                // Try again in a few seconds
                setTimeout(findDroneEntity, 5000);
                return;
            }
            
            // Find controller script
            if (droneEntity.script) {
                // Look through all scripts for controller-like scripts
                var scriptNames = [];
                for (var key in droneEntity.script) {
                    if (droneEntity.script.hasOwnProperty(key)) {
                        scriptNames.push(key);
                    }
                }
                
                log("Scripts on drone: " + scriptNames.join(", "));
                
                for (var i = 0; i < scriptNames.length; i++) {
                    var scriptName = scriptNames[i];
                    var script = droneEntity.script[scriptName];
                    
                    if (script && (
                        scriptName.toLowerCase().includes('controller') || 
                        scriptName.toLowerCase().includes('control') ||
                        scriptName.toLowerCase().includes('input'))) {
                        droneController = script;
                        log("Found potential controller script: " + scriptName);
                        
                        // Check for control properties
                        controlProps = detectControlProperties(script);
                        if (controlProps.valid) {
                            log("✅ Found control properties in script: " + scriptName);
                            log("Control properties: thrust=" + controlProps.thrust + 
                                ", pitch=" + controlProps.pitch + 
                                ", roll=" + controlProps.roll + 
                                ", yaw=" + controlProps.yaw);
                            break;
                        }
                    }
                }
            }
            
            if (!droneController || !controlProps.valid) {
                // If we didn't find a controller, look for common property names on the entity itself
                controlProps = detectControlProperties(droneEntity);
                if (controlProps.valid) {
                    droneController = droneEntity;
                    log("✅ Found control properties on the entity itself");
                } else {
                    log("⚠️ Could not find drone controller with control properties.", true);
                    
                    // Debug log all properties on the entity
                    if (droneEntity) {
                        log("Debug: Entity properties for " + droneEntity.name);
                        // List a few common script properties
                        if (droneEntity.script) {
                            for (var key in droneEntity.script) {
                                if (droneEntity.script.hasOwnProperty(key)) {
                                    var script = droneEntity.script[key];
                                    log("  Script: " + key);
                                    // Try to list properties of the script
                                    try {
                                        for (var prop in script) {
                                            if (typeof script[prop] !== 'function' && 
                                                typeof script[prop] !== 'object') {
                                                log("    " + prop + " = " + script[prop]);
                                            }
                                        }
                                    } catch (e) {
                                        log("    Error listing properties: " + e);
                                    }
                                }
                            }
                        }
                    }
                    
                    // In PlayCanvas, sometimes we need to use script attribute syntax
                    log("Using fallback control properties.");
                    controlProps = {
                        valid: true,
                        thrust: "throttle",
                        pitch: "pitch", 
                        roll: "roll",
                        yaw: "yaw",
                        inputProperties: ["throttle", "pitch", "roll", "yaw"]
                    };
                    droneController = droneEntity;
                }
            }
            
            // Expose for debugging
            window.droneWsEntity = droneEntity;
            window.droneWsController = droneController;
            window.droneWsControlProps = controlProps;
        }
        
        /**
         * Try to detect control properties in an object
         */
        function detectControlProperties(obj) {
            var result = {
                valid: false,
                thrust: null,
                pitch: null,
                roll: null,
                yaw: null,
                inputProperties: []
            };
            
            if (!obj) return result;
            
            // Common property names for thrust/throttle
            var thrustProps = ['thrust', 'throttle', 'power', 'lift', 'thrustInput', 'throttleInput', 'thrustControl'];
            
            // Common property names for pitch
            var pitchProps = ['pitch', 'pitchInput', 'pitchControl', 'forward', 'forwardInput', 'elevationInput'];
            
            // Common property names for roll
            var rollProps = ['roll', 'rollInput', 'rollControl', 'lateral', 'lateralInput', 'sideInput'];
            
            // Common property names for yaw
            var yawProps = ['yaw', 'yawInput', 'yawControl', 'rotation', 'rotationInput', 'headingInput', 'direction'];
            
            // Try to find matching properties
            for (var prop in obj) {
                // Skip functions and objects
                if (typeof obj[prop] === 'function' || (typeof obj[prop] === 'object' && obj[prop] !== null)) continue;
                
                // Collect all potential input properties for debugging
                result.inputProperties.push(prop);
                
                // Check for thrust property
                if (!result.thrust) {
                    for (var i = 0; i < thrustProps.length; i++) {
                        if (prop.toLowerCase() === thrustProps[i].toLowerCase()) {
                            result.thrust = prop;
                            break;
                        }
                    }
                }
                
                // Check for pitch property
                if (!result.pitch) {
                    for (var i = 0; i < pitchProps.length; i++) {
                        if (prop.toLowerCase() === pitchProps[i].toLowerCase()) {
                            result.pitch = prop;
                            break;
                        }
                    }
                }
                
                // Check for roll property
                if (!result.roll) {
                    for (var i = 0; i < rollProps.length; i++) {
                        if (prop.toLowerCase() === rollProps[i].toLowerCase()) {
                            result.roll = prop;
                            break;
                        }
                    }
                }
                
                // Check for yaw property
                if (!result.yaw) {
                    for (var i = 0; i < yawProps.length; i++) {
                        if (prop.toLowerCase() === yawProps[i].toLowerCase()) {
                            result.yaw = prop;
                            break;
                        }
                    }
                }
            }
            
            // Check if we found all necessary properties
            result.valid = result.thrust && result.pitch && result.roll && result.yaw;
            return result;
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
            
            // Reset drone position
            if (droneEntity) {
                // Try to reset position to origin
                droneEntity.setPosition(0, 2, 0); // Y=2 to start slightly above ground
                droneEntity.setEulerAngles(0, 0, 0);
                
                // If there's a rigidbody, reset velocities
                if (droneEntity.rigidbody) {
                    droneEntity.rigidbody.linearVelocity = new pc.Vec3(0, 0, 0);
                    droneEntity.rigidbody.angularVelocity = new pc.Vec3(0, 0, 0);
                }
                
                // Try reset method if it exists
                if (droneController && typeof droneController.reset === 'function') {
                    droneController.reset();
                }
                
                log("Reset drone position and rotation");
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
                if (message.type === 'control' && externalControlEnabled && droneController && controlProps.valid) {
                    // Apply control to drone based on detected properties
                    if (typeof message.thrust === 'number' && controlProps.thrust) {
                        droneController[controlProps.thrust] = message.thrust;
                    }
                    if (typeof message.pitch === 'number' && controlProps.pitch) {
                        droneController[controlProps.pitch] = message.pitch;
                    }
                    if (typeof message.roll === 'number' && controlProps.roll) {
                        droneController[controlProps.roll] = message.roll;
                    }
                    if (typeof message.yaw === 'number' && controlProps.yaw) {
                        droneController[controlProps.yaw] = message.yaw;
                    }
                    
                    log("Received control: " + 
                        "thrust=" + message.thrust.toFixed(2) + ", " +
                        "pitch=" + message.pitch.toFixed(2) + ", " +
                        "roll=" + message.roll.toFixed(2) + ", " +
                        "yaw=" + message.yaw.toFixed(2));
                } else if (message.type === 'config') {
                    if (typeof message.externalControl === 'boolean') {
                        externalControlEnabled = message.externalControl;
                        updateControlToggle();
                        log("External control " + (externalControlEnabled ? "enabled" : "disabled"));
                    }
                } else if (message.type === 'reset') {
                    if (droneEntity) {
                        // Try to reset position to origin
                        droneEntity.setPosition(0, 2, 0); // Y=2 to start slightly above ground
                        droneEntity.setEulerAngles(0, 0, 0);

                        resetDrone()
                        
                        // If there's a rigidbody, reset velocities
                        if (droneEntity.rigidbody) {
                            droneEntity.rigidbody.linearVelocity = new pc.Vec3(0, 0, 0);
                            droneEntity.rigidbody.angularVelocity = new pc.Vec3(0, 0, 0);
                        }
                        
                        // Try reset method if it exists
                        if (droneController && typeof droneController.reset === 'function') {
                            droneController.reset();
                        }
                        
                        log("Reset drone position and rotation");
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
            
            // Drone status display
            var droneStatusEl = document.createElement('div');
            droneStatusEl.style.fontSize = '10px';
            droneStatusEl.style.marginTop = '3px'; 
            droneStatusEl.textContent = 'Searching for drone...';
            container.appendChild(droneStatusEl);
            
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
            
            // Update drone status periodically
            setInterval(function() {
                if (droneEntity) {
                    if (controlProps.valid) {
                        droneStatusEl.textContent = 'Drone: ' + droneEntity.name + ' (Controls: ✅)';
                        droneStatusEl.style.color = '#88ff88';
                    } else {
                        droneStatusEl.textContent = 'Drone: ' + droneEntity.name + ' (Controls: ❌)';
                        droneStatusEl.style.color = '#ff8888';
                    }
                } else {
                    droneStatusEl.textContent = 'Drone: Not Found';
                    droneStatusEl.style.color = '#ff8888';
                }
            }, 1000);
            
            // Start the update loop to send drone state
            setInterval(function() {
                if (connected && socket) {
                    sendDroneState();
                }
            }, 100);  // Send state 10 times per second
            
            return {
                container: container,
                statusEl: statusEl,
                droneStatusEl: droneStatusEl,
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
            droneStatusEl: null,
            connectBtn: null,
            disconnectBtn: null,
            resetBtn: null,
            controlCheckbox: null
        };
    }
})(); 