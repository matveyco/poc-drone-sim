/**
 * PlayCanvas Drone Adapter - Connects WebSocket commands to your specific PlayCanvas drone
 */
(function() {
    window.addEventListener('load', function() {
        setTimeout(initializeDroneAdapter, 2000);
    });
    
    function initializeDroneAdapter() {
        console.log("Initializing PlayCanvas Drone Adapter...");
        
        // Configuration
        const config = {
            wsUrl: 'ws://localhost:8765',
            autoConnect: true,
            debug: true
        };
        
        // State
        let socket = null;
        let connected = false;
        let externalControlEnabled = false;
        let droneController = null;
        
        // Create UI
        const ui = createUI();
        
        // Find drone controller
        findDroneController();
        
        // Auto-connect if enabled
        if (config.autoConnect) {
            setTimeout(connect, 1000);
        }
        
        /**
         * Find the drone controller in the scene
         */
        function findDroneController() {
            if (!window.pc || !window.pc.app) {
                log("PlayCanvas app not found, will retry...");
                setTimeout(findDroneController, 1000);
                return;
            }
            
            // Look for entities with a droneController script
            let foundController = false;
            window.pc.app.root.forEach(function(entity) {
                if (entity.script && entity.script.droneController) {
                    droneController = entity.script.droneController;
                    log("✅ Found drone controller on entity: " + entity.name);
                    
                    // Make it globally accessible for debugging
                    window.droneController = droneController;
                    
                    // Check controller specific properties
                    log("Controller properties:");
                    log("- speed: " + droneController.speed);
                    log("- turnSpeed: " + droneController.turnSpeed);
                    log("- verticalSpeed: " + droneController.verticalSpeed);
                    log("- groundHeight: " + droneController.groundHeight);
                    
                    foundController = true;
                    
                    // Update UI
                    if (ui.droneStatusEl) {
                        ui.droneStatusEl.textContent = "Drone: " + entity.name;
                        ui.droneStatusEl.style.color = "#88ff88";
                    }
                }
            });
            
            if (!foundController) {
                log("❌ Could not find a drone controller script. Will retry in 5 seconds.", true);
                setTimeout(findDroneController, 5000);
            }
        }
        
        /**
         * Connect to WebSocket server
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
         * Disconnect from WebSocket
         */
        function disconnect() {
            if (socket) {
                socket.close();
                socket = null;
                connected = false;
                updateStatus("Disconnected");
            }
        }
        
        /**
         * Set external control enabled/disabled
         */
        function setExternalControl(enabled) {
            externalControlEnabled = enabled;
            log("External control " + (enabled ? "enabled" : "disabled"));
            
            if (socket && connected) {
                socket.send(JSON.stringify({
                    type: 'config_ack',
                    settings: {
                        externalControl: enabled
                    },
                    timestamp: Date.now()
                }));
            }
            
            updateControlToggle();
        }
        
        /**
         * Handle incoming WebSocket messages
         */
        function handleMessage(data) {
            try {
                const message = JSON.parse(data);
                log("Received: " + JSON.stringify(message));
                
                if (message.type === 'control' && externalControlEnabled && droneController) {
                    // Map WebSocket control values to drone controller inputs
                    // IMPORTANT: We're injecting these values directly into the keyboard simulation
                    droneController._externalInputs = {
                        // Vertical control (space/shift)
                        upDown: Math.max(-1, Math.min(1, message.thrust * 2 - 1)),
                        
                        // Forward/Backward (W/S)
                        forwardBack: -Math.max(-1, Math.min(1, message.pitch * 2)),
                        
                        // Left/Right (A/D)
                        leftRight: -Math.max(-1, Math.min(1, message.roll * 2)),
                        
                        // Yaw (Q/E)
                        yaw: -Math.max(-1, Math.min(1, message.yaw * 2)),
                        
                        // Timestamp of last control
                        lastControl: Date.now()
                    };
                    
                    log("Applying control: up=" + droneController._externalInputs.upDown.toFixed(2) + 
                        ", forward=" + droneController._externalInputs.forwardBack.toFixed(2) + 
                        ", right=" + droneController._externalInputs.leftRight.toFixed(2) + 
                        ", yaw=" + droneController._externalInputs.yaw.toFixed(2));
                }
                else if (message.type === 'config') {
                    if (typeof message.externalControl !== 'undefined') {
                        setExternalControl(message.externalControl);
                    }
                }
                else if (message.type === 'reset') {
                    resetDrone();
                    socket.send(JSON.stringify({
                        type: 'reset_ack',
                        timestamp: Date.now()
                    }));
                }
            } catch (e) {
                log("Error parsing message: " + e, true);
            }
        }
        
        /**
         * Send drone state to the server
         */
        function sendDroneState() {
            if (!socket || !connected || !droneController) return;
            
            try {
                // Get drone position and rotation
                const entity = droneController.entity;
                const position = entity.getPosition();
                const rotation = entity.getEulerAngles();
                
                // Calculate velocity
                let velocity = { x: 0, y: 0, z: 0 };
                if (droneController.velocity) {
                    velocity = {
                        x: droneController.velocity.x,
                        y: droneController.velocity.y,
                        z: droneController.velocity.z
                    };
                }
                
                // Get target position from app.globals
                const targetPosition = {
                    x: 30, // Default to coordinates from the instructions
                    y: 0,
                    z: 30
                };
                
                // Calculate distance to target
                const dx = position.x - targetPosition.x;
                const dy = position.y - targetPosition.y;
                const dz = position.z - targetPosition.z;
                const distanceToTarget = Math.sqrt(dx*dx + dy*dy + dz*dz);
                
                // Draw line to target
                drawLineToTarget(position, targetPosition);
                
                const state = {
                    type: 'state',
                    position: {
                        x: position.x,
                        y: position.y,
                        z: position.z
                    },
                    rotation: {
                        x: rotation.x,
                        y: rotation.y,
                        z: rotation.z
                    },
                    velocity: velocity,
                    isFlying: droneController.isFlying,
                    distanceToTarget: distanceToTarget,
                    timestamp: Date.now()
                };
                
                // Update distance display
                updateDistanceDisplay(distanceToTarget);
                
                socket.send(JSON.stringify(state));
            } catch (e) {
                log("Error sending state: " + e, true);
            }
        }
        
        // Line to target variables
        let targetLine = null;
        let targetLineEntity = null;
        
        /**
         * Draw a line from drone to target
         */
        function drawLineToTarget(dronePos, targetPos) {
            try {
                if (!window.pc || !window.pc.app) return;
                
                // If we already have a line entity, just remove it to avoid complications
                if (targetLineEntity) {
                    targetLineEntity.destroy();
                    targetLineEntity = null;
                }
                
                // Create a simple debug line - this works in most PlayCanvas versions
                if (window.pc.Application.prototype.drawLine) {
                    // Use built-in debug line if available
                    window.pc.app.drawLine(
                        new pc.Vec3(dronePos.x, dronePos.y, dronePos.z),
                        new pc.Vec3(targetPos.x, targetPos.y, targetPos.z),
                        new pc.Color(1, 0, 0)
                    );
                } else {
                    // Fall back to create a simple line with cylinders if debug lines not available
                    
                    // Create a new entity for the line
                    targetLineEntity = new pc.Entity("targetLine");
                    window.pc.app.root.addChild(targetLineEntity);
                    
                    // Calculate the midpoint between drone and target
                    const midX = (dronePos.x + targetPos.x) / 2;
                    const midY = (dronePos.y + targetPos.y) / 2;
                    const midZ = (dronePos.z + targetPos.z) / 2;
                    
                    // Calculate distance and direction
                    const dx = targetPos.x - dronePos.x;
                    const dy = targetPos.y - dronePos.y;
                    const dz = targetPos.z - dronePos.z;
                    const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
                    
                    // Add a cylinder primitive
                    targetLineEntity.addComponent('render', {
                        type: 'cylinder',
                        material: new pc.StandardMaterial()
                    });
                    
                    // Set position and scale
                    targetLineEntity.setPosition(midX, midY, midZ);
                    targetLineEntity.setLocalScale(0.1, distance, 0.1);
                    
                    // Point it in the right direction
                    targetLineEntity.lookAt(new pc.Vec3(targetPos.x, targetPos.y, targetPos.z));
                    
                    // Set the material color
                    if (targetLineEntity.render && targetLineEntity.render.material) {
                        targetLineEntity.render.material.diffuse = new pc.Color(1, 0, 0);
                        targetLineEntity.render.material.update();
                    }
                    
                    log("Created target line entity using cylinder approach");
                }
            } catch (e) {
                log("Error drawing target line: " + e, true);
            }
        }
        
        /**
         * Update distance display
         */
        function updateDistanceDisplay(distance) {
            if (!ui.distanceEl) return;
            
            ui.distanceEl.textContent = `Distance to Target: ${distance.toFixed(2)}m`;
            
            // Change color based on distance
            if (distance < 5) {
                ui.distanceEl.style.color = "#00ff00"; // Green when close
            } else if (distance < 20) {
                ui.distanceEl.style.color = "#ffff00"; // Yellow when medium
            } else {
                ui.distanceEl.style.color = "#ff6600"; // Orange when far
            }
        }
        
        /**
         * Reset the drone position
         */
        function resetDrone() {
            if (!droneController) return;
            
            try {
                log("Resetting drone position");
                
                // Get the drone entity
                const entity = droneController.entity;
                
                // Reset position
                entity.setPosition(0, droneController.groundHeight, 0);
                
                // Reset rotation
                entity.setEulerAngles(0, 180, 0);
                
                // Reset any other state in the controller
                droneController.isFlying = false;
                
                if (droneController._moveDir) {
                    droneController._moveDir.set(0, 0, 0);
                }
                
                if (droneController.velocity) {
                    droneController.velocity.set(0, 0, 0);
                }
                
                log("Drone reset complete");
            } catch (e) {
                log("Error resetting drone: " + e, true);
            }
        }
        
        /**
         * Create the UI
         */
        function createUI() {
            // Create container
            const container = document.createElement('div');
            container.style.position = 'fixed';
            container.style.top = '10px';
            container.style.left = '10px';
            container.style.width = '220px';
            container.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
            container.style.color = '#fff';
            container.style.padding = '10px';
            container.style.borderRadius = '5px';
            container.style.fontFamily = 'Arial, sans-serif';
            container.style.fontSize = '12px';
            container.style.zIndex = '1000';
            
            // Title
            const title = document.createElement('div');
            title.textContent = 'Drone WebSocket Adapter';
            title.style.fontWeight = 'bold';
            title.style.marginBottom = '5px';
            title.style.textAlign = 'center';
            container.appendChild(title);
            
            // Status
            const statusEl = document.createElement('div');
            statusEl.textContent = 'WebSocket: Not Connected';
            statusEl.style.marginBottom = '5px';
            statusEl.style.padding = '3px';
            statusEl.style.borderRadius = '3px';
            statusEl.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
            container.appendChild(statusEl);
            
            // Drone status
            const droneStatusEl = document.createElement('div');
            droneStatusEl.textContent = 'Drone: Searching...';
            droneStatusEl.style.marginBottom = '10px';
            droneStatusEl.style.fontSize = '11px';
            container.appendChild(droneStatusEl);
            
            // Buttons
            const buttonContainer = document.createElement('div');
            buttonContainer.style.display = 'flex';
            buttonContainer.style.gap = '5px';
            buttonContainer.style.marginBottom = '10px';
            
            // Connect button
            const connectBtn = document.createElement('button');
            connectBtn.textContent = 'Connect';
            connectBtn.style.flex = '1';
            connectBtn.addEventListener('click', connect);
            buttonContainer.appendChild(connectBtn);
            
            // Disconnect button
            const disconnectBtn = document.createElement('button');
            disconnectBtn.textContent = 'Disconnect';
            disconnectBtn.style.flex = '1';
            disconnectBtn.disabled = true;
            disconnectBtn.addEventListener('click', disconnect);
            buttonContainer.appendChild(disconnectBtn);
            
            container.appendChild(buttonContainer);
            
            // Reset button
            const resetBtn = document.createElement('button');
            resetBtn.textContent = 'Reset Drone Position';
            resetBtn.style.width = '100%';
            resetBtn.style.marginBottom = '10px';
            resetBtn.addEventListener('click', resetDrone);
            container.appendChild(resetBtn);
            
            // Control toggle
            const controlToggle = document.createElement('div');
            controlToggle.style.marginBottom = '5px';
            
            const controlCheckbox = document.createElement('input');
            controlCheckbox.type = 'checkbox';
            controlCheckbox.id = 'external-control';
            controlCheckbox.disabled = true;
            controlCheckbox.addEventListener('change', function(e) {
                setExternalControl(e.target.checked);
            });
            
            const controlLabel = document.createElement('label');
            controlLabel.htmlFor = 'external-control';
            controlLabel.textContent = ' Enable External Control';
            controlLabel.style.marginLeft = '5px';
            
            controlToggle.appendChild(controlCheckbox);
            controlToggle.appendChild(controlLabel);
            container.appendChild(controlToggle);
            
            // Add distance display
            const distanceEl = document.createElement('div');
            distanceEl.textContent = 'Distance to Target: --';
            distanceEl.style.marginTop = '10px';
            distanceEl.style.padding = '3px';
            distanceEl.style.borderRadius = '3px';
            distanceEl.style.backgroundColor = 'rgba(0, 0, 0, 0.4)';
            distanceEl.style.fontWeight = 'bold';
            container.appendChild(distanceEl);
            
            // Add to document
            document.body.appendChild(container);
            
            // Start the update loop to send drone state
            setInterval(function() {
                if (connected && socket && droneController) {
                    sendDroneState();
                }
            }, 100);  // Send state 10 times per second
            
            return {
                container: container,
                statusEl: statusEl,
                droneStatusEl: droneStatusEl,
                connectBtn: connectBtn,
                disconnectBtn: disconnectBtn,
                controlCheckbox: controlCheckbox,
                distanceEl: distanceEl
            };
        }
        
        /**
         * Update status display
         */
        function updateStatus(status, isConnected) {
            ui.statusEl.textContent = 'WebSocket: ' + status;
            ui.statusEl.style.backgroundColor = isConnected ? 'rgba(0, 255, 0, 0.2)' : 'rgba(255, 0, 0, 0.2)';
            
            ui.connectBtn.disabled = isConnected || status === 'Connecting...';
            ui.disconnectBtn.disabled = !isConnected;
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
                console.log('[DroneAdapter] ' + message);
            }
        }
    }
})(); 