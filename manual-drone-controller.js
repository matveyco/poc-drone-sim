/**
 * Manual Drone Controller - Helps identify and debug drone control issues
 */
(function() {
    // Wait for page to load
    window.addEventListener('load', function() {
        setTimeout(initializeManualController, 2000);
    });
    
    function initializeManualController() {
        console.log("[ManualDroneController] Initializing...");
        
        // Configuration
        var config = {
            wsUrl: 'ws://localhost:8765',
            autoConnect: true,
            debug: true
        };
        
        // State
        var socket = null;
        var connected = false;
        var externalControlEnabled = false;
        var selectedEntity = null;
        var controlProps = {
            thrust: null,
            pitch: null, 
            roll: null,
            yaw: null
        };
        
        // Create UI with detailed controls and entity selection
        var ui = createDetailedUI();
        
        // Auto connect
        if (config.autoConnect) {
            setTimeout(connect, 1000);
        }
        
        /**
         * Connect to WebSocket
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
         * Handle messages from the server
         */
        function handleMessage(data) {
            try {
                var message = JSON.parse(data);
                
                if (message.type === 'control' && externalControlEnabled && selectedEntity) {
                    // Apply controls directly to the selected entity
                    applyControls(
                        message.thrust || 0,
                        message.pitch || 0,
                        message.roll || 0,
                        message.yaw || 0
                    );
                }
                else if (message.type === 'reset') {
                    resetDrone();
                }
            } catch (e) {
                log("Error parsing message: " + e, true);
            }
        }
        
        /**
         * Apply controls to the selected entity
         */
        function applyControls(thrust, pitch, roll, yaw) {
            if (!selectedEntity) return;
            
            // Update UI sliders
            ui.thrustSlider.value = thrust;
            ui.pitchSlider.value = pitch;
            ui.rollSlider.value = roll;
            ui.yawSlider.value = yaw;
            
            ui.thrustValue.textContent = thrust.toFixed(2);
            ui.pitchValue.textContent = pitch.toFixed(2);
            ui.rollValue.textContent = roll.toFixed(2);
            ui.yawValue.textContent = yaw.toFixed(2);
            
            // Apply the controls using the stored property names
            if (controlProps.thrust) {
                if (typeof controlProps.thrust === 'function') {
                    controlProps.thrust(thrust);
                } else if (selectedEntity.script && selectedEntity.script[controlProps.thrust]) {
                    selectedEntity.script[controlProps.thrust] = thrust;
                } else {
                    // Try direct property access
                    setNestedProperty(selectedEntity, controlProps.thrust, thrust);
                }
            }
            
            if (controlProps.pitch) {
                if (typeof controlProps.pitch === 'function') {
                    controlProps.pitch(pitch);
                } else if (selectedEntity.script && selectedEntity.script[controlProps.pitch]) {
                    selectedEntity.script[controlProps.pitch] = pitch;
                } else {
                    setNestedProperty(selectedEntity, controlProps.pitch, pitch);
                }
            }
            
            if (controlProps.roll) {
                if (typeof controlProps.roll === 'function') {
                    controlProps.roll(roll);
                } else if (selectedEntity.script && selectedEntity.script[controlProps.roll]) {
                    selectedEntity.script[controlProps.roll] = roll;
                } else {
                    setNestedProperty(selectedEntity, controlProps.roll, roll);
                }
            }
            
            if (controlProps.yaw) {
                if (typeof controlProps.yaw === 'function') {
                    controlProps.yaw(yaw);
                } else if (selectedEntity.script && selectedEntity.script[controlProps.yaw]) {
                    selectedEntity.script[controlProps.yaw] = yaw;
                } else {
                    setNestedProperty(selectedEntity, controlProps.yaw, yaw);
                }
            }
            
            // Direct force application as a fallback
            if (!controlProps.thrust && !controlProps.pitch && !controlProps.roll && !controlProps.yaw) {
                applyDirectForces(thrust, pitch, roll, yaw);
            }
        }
        
        /**
         * Apply forces directly to the entity as a fallback
         */
        function applyDirectForces(thrust, pitch, roll, yaw) {
            if (!selectedEntity || !selectedEntity.rigidbody) return;
            
            var forceMultiplier = 10;  // Adjust based on your physics scale
            
            // Calculate force direction based on entity's orientation
            var forward = selectedEntity.forward.clone().scale(-pitch * forceMultiplier);
            var right = selectedEntity.right.clone().scale(roll * forceMultiplier);
            var up = new pc.Vec3(0, 1, 0).scale(thrust * forceMultiplier);
            
            // Apply forces
            var force = new pc.Vec3();
            force.add(forward).add(right).add(up);
            
            selectedEntity.rigidbody.applyForce(force);
            
            // Apply torque for yaw
            var torque = new pc.Vec3(0, yaw * forceMultiplier, 0);
            selectedEntity.rigidbody.applyTorque(torque);
            
            log("Applied direct forces: " + JSON.stringify({
                thrust: thrust, 
                pitch: pitch, 
                roll: roll, 
                yaw: yaw
            }));
        }
        
        /**
         * Reset the drone position
         */
        function resetDrone() {
            if (!selectedEntity) return;
            
            // Try to reset position
            selectedEntity.setPosition(0, 2, 0);
            selectedEntity.setEulerAngles(0, 0, 0);
            
            // Reset velocities if rigidbody exists
            if (selectedEntity.rigidbody) {
                selectedEntity.rigidbody.linearVelocity = new pc.Vec3(0, 0, 0);
                selectedEntity.rigidbody.angularVelocity = new pc.Vec3(0, 0, 0);
            }
            
            log("Reset drone position and rotation");
        }
        
        /**
         * Send drone state to WebSocket
         */
        function sendDroneState() {
            if (!connected || !socket || !selectedEntity) return;
            
            var position = selectedEntity.getPosition();
            var rotation = selectedEntity.getEulerAngles();
            var linearVelocity = selectedEntity.rigidbody ? selectedEntity.rigidbody.linearVelocity : new pc.Vec3();
            var angularVelocity = selectedEntity.rigidbody ? selectedEntity.rigidbody.angularVelocity : new pc.Vec3();
            
            var state = {
                type: 'state',
                position: { x: position.x, y: position.y, z: position.z },
                rotation: { x: rotation.x, y: rotation.y, z: rotation.z },
                linearVelocity: { x: linearVelocity.x, y: linearVelocity.y, z: linearVelocity.z },
                angularVelocity: { x: angularVelocity.x, y: angularVelocity.y, z: angularVelocity.z },
                timestamp: Date.now()
            };
            
            socket.send(JSON.stringify(state));
        }
        
        /**
         * Set external control mode
         */
        function setExternalControl(enable) {
            externalControlEnabled = enable;
            log((enable ? "Enabled" : "Disabled") + " external control");
            
            if (connected && socket) {
                socket.send(JSON.stringify({
                    type: 'config',
                    externalControl: enable,
                    timestamp: Date.now()
                }));
            }
            
            updateControlToggle();
        }
        
        /**
         * Create detailed UI with entity selection and control visualization
         */
        function createDetailedUI() {
            // Create container
            var container = document.createElement('div');
            container.style.position = 'absolute';
            container.style.top = '10px';
            container.style.right = '10px';
            container.style.background = 'rgba(0, 0, 0, 0.8)';
            container.style.color = 'white';
            container.style.padding = '15px';
            container.style.borderRadius = '8px';
            container.style.fontFamily = 'Arial, sans-serif';
            container.style.fontSize = '14px';
            container.style.zIndex = '1000';
            container.style.width = '300px';
            container.style.maxHeight = '90vh';
            container.style.overflowY = 'auto';
            
            // Title
            var title = document.createElement('h3');
            title.textContent = 'Manual Drone Controller';
            title.style.margin = '0 0 10px 0';
            title.style.textAlign = 'center';
            container.appendChild(title);
            
            // Status display
            var statusEl = document.createElement('div');
            statusEl.textContent = 'WebSocket: Not Connected';
            statusEl.style.marginBottom = '10px';
            statusEl.style.padding = '5px';
            statusEl.style.borderRadius = '4px';
            statusEl.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
            statusEl.style.textAlign = 'center';
            container.appendChild(statusEl);
            
            // Connection buttons
            var connectionBtns = document.createElement('div');
            connectionBtns.style.display = 'flex';
            connectionBtns.style.gap = '5px';
            connectionBtns.style.marginBottom = '15px';
            
            var connectBtn = document.createElement('button');
            connectBtn.textContent = 'Connect';
            connectBtn.style.flex = '1';
            connectBtn.style.padding = '8px';
            connectBtn.addEventListener('click', connect);
            connectionBtns.appendChild(connectBtn);
            
            var disconnectBtn = document.createElement('button');
            disconnectBtn.textContent = 'Disconnect';
            disconnectBtn.style.flex = '1';
            disconnectBtn.style.padding = '8px';
            disconnectBtn.disabled = true;
            disconnectBtn.addEventListener('click', disconnect);
            connectionBtns.appendChild(disconnectBtn);
            
            container.appendChild(connectionBtns);
            
            // Entity selection
            var entitySection = document.createElement('div');
            entitySection.style.border = '1px solid rgba(255, 255, 255, 0.2)';
            entitySection.style.padding = '10px';
            entitySection.style.borderRadius = '4px';
            entitySection.style.marginBottom = '15px';
            
            var entityLabel = document.createElement('div');
            entityLabel.textContent = 'Select Drone Entity:';
            entityLabel.style.marginBottom = '5px';
            entitySection.appendChild(entityLabel);
            
            var entitySelect = document.createElement('select');
            entitySelect.style.width = '100%';
            entitySelect.style.padding = '5px';
            entitySelect.style.marginBottom = '10px';
            entitySelect.style.backgroundColor = '#222';
            entitySelect.style.color = 'white';
            entitySelect.style.border = '1px solid #444';
            
            // Add a placeholder option
            var placeholderOption = document.createElement('option');
            placeholderOption.textContent = '-- Select an entity --';
            placeholderOption.value = '';
            entitySelect.appendChild(placeholderOption);
            
            // Function to populate entity list
            function populateEntityList() {
                // Clear existing options except the placeholder
                while (entitySelect.options.length > 1) {
                    entitySelect.remove(1);
                }
                
                if (!window.pc || !window.pc.app) {
                    return;
                }
                
                var entities = [];
                
                // Helper function to recursively find all entities
                function findEntities(entity) {
                    entities.push(entity);
                    for (var i = 0; i < entity.children.length; i++) {
                        findEntities(entity.children[i]);
                    }
                }
                
                // Start from the root entity
                findEntities(window.pc.app.root);
                
                // Add all entities to the dropdown
                entities.forEach(function(entity) {
                    // Only add entities that have scripts or rigidbody
                    if (entity.script || entity.rigidbody) {
                        var option = document.createElement('option');
                        option.textContent = entity.name + (entity.parent !== window.pc.app.root ? ' (Child)' : '');
                        option.value = entity.name;
                        option.entity = entity;  // Store the entity reference
                        entitySelect.appendChild(option);
                    }
                });
            }
            
            // Populate initially and every 5 seconds
            populateEntityList();
            setInterval(populateEntityList, 5000);
            
            entitySelect.addEventListener('change', function() {
                var selectedOption = entitySelect.options[entitySelect.selectedIndex];
                selectedEntity = selectedOption.entity;
                
                if (selectedEntity) {
                    log("Selected entity: " + selectedEntity.name);
                    updateEntityInfo();
                } else {
                    log("No entity selected");
                    entityInfoEl.textContent = "No entity selected";
                }
            });
            
            entitySection.appendChild(entitySelect);
            
            // Entity info display
            var entityInfoEl = document.createElement('div');
            entityInfoEl.style.fontSize = '12px';
            entityInfoEl.style.fontFamily = 'monospace';
            entityInfoEl.style.whiteSpace = 'pre-wrap';
            entityInfoEl.style.backgroundColor = 'rgba(0, 0, 0, 0.3)';
            entityInfoEl.style.padding = '5px';
            entityInfoEl.style.borderRadius = '4px';
            entityInfoEl.style.maxHeight = '100px';
            entityInfoEl.style.overflowY = 'auto';
            entityInfoEl.textContent = "No entity selected";
            entitySection.appendChild(entityInfoEl);
            
            // Function to update entity info
            function updateEntityInfo() {
                if (!selectedEntity) {
                    entityInfoEl.textContent = "No entity selected";
                    return;
                }
                
                var info = "Name: " + selectedEntity.name + "\n";
                
                if (selectedEntity.script) {
                    info += "Scripts: " + Object.keys(selectedEntity.script).join(", ") + "\n";
                }
                
                if (selectedEntity.rigidbody) {
                    info += "Has Rigidbody: Yes\n";
                } else {
                    info += "Has Rigidbody: No\n";
                }
                
                entityInfoEl.textContent = info;
            }
            
            container.appendChild(entitySection);
            
            // Control properties section
            var controlSection = document.createElement('div');
            controlSection.style.border = '1px solid rgba(255, 255, 255, 0.2)';
            controlSection.style.padding = '10px';
            controlSection.style.borderRadius = '4px';
            controlSection.style.marginBottom = '15px';
            
            var controlLabel = document.createElement('div');
            controlLabel.textContent = 'Control Properties:';
            controlLabel.style.marginBottom = '5px';
            controlSection.appendChild(controlLabel);
            
            // Helper function to create a control property input
            function createControlInput(name, placeholder) {
                var container = document.createElement('div');
                container.style.display = 'flex';
                container.style.marginBottom = '5px';
                container.style.alignItems = 'center';
                
                var label = document.createElement('label');
                label.textContent = name + ': ';
                label.style.flex = '0 0 50px';
                container.appendChild(label);
                
                var input = document.createElement('input');
                input.type = 'text';
                input.placeholder = placeholder;
                input.style.flex = '1';
                input.style.padding = '5px';
                input.style.backgroundColor = '#222';
                input.style.color = 'white';
                input.style.border = '1px solid #444';
                container.appendChild(input);
                
                return { container, input };
            }
            
            var thrustInput = createControlInput('Thrust', 'thrust or throttle');
            var pitchInput = createControlInput('Pitch', 'pitch or elevation');
            var rollInput = createControlInput('Roll', 'roll or bank');
            var yawInput = createControlInput('Yaw', 'yaw or heading');
            
            controlSection.appendChild(thrustInput.container);
            controlSection.appendChild(pitchInput.container);
            controlSection.appendChild(rollInput.container);
            controlSection.appendChild(yawInput.container);
            
            // Apply button
            var applyBtn = document.createElement('button');
            applyBtn.textContent = 'Apply Control Properties';
            applyBtn.style.width = '100%';
            applyBtn.style.padding = '8px';
            applyBtn.style.marginTop = '5px';
            applyBtn.addEventListener('click', function() {
                controlProps.thrust = thrustInput.input.value;
                controlProps.pitch = pitchInput.input.value;
                controlProps.roll = rollInput.input.value;
                controlProps.yaw = yawInput.input.value;
                
                log("Applied control properties: " + JSON.stringify(controlProps));
                
                // Try to use the properties immediately with some default values
                try {
                    applyControls(0.5, 0, 0, 0);
                } catch (e) {
                    log("Error testing control properties: " + e, true);
                }
            });
            controlSection.appendChild(applyBtn);
            
            // Detect button
            var detectBtn = document.createElement('button');
            detectBtn.textContent = 'Auto-Detect Properties';
            detectBtn.style.width = '100%';
            detectBtn.style.padding = '8px';
            detectBtn.style.marginTop = '5px';
            detectBtn.addEventListener('click', function() {
                if (!selectedEntity) {
                    log("No entity selected", true);
                    return;
                }
                
                // Try to detect control properties
                log("Attempting to auto-detect control properties...");
                
                var detectedProps = {
                    thrust: null,
                    pitch: null,
                    roll: null,
                    yaw: null
                };
                
                // Common property names for each control
                var thrustProps = ['thrust', 'throttle', 'thrustInput', 'throttleInput', 'lift', 'power'];
                var pitchProps = ['pitch', 'pitchInput', 'elev', 'elevator', 'elevation'];
                var rollProps = ['roll', 'rollInput', 'bank', 'bankInput', 'aileron'];
                var yawProps = ['yaw', 'yawInput', 'rudder', 'heading', 'direction'];
                
                // Check if entity has rigidbody for direct force application
                if (selectedEntity.rigidbody) {
                    log("Entity has rigidbody - can use direct force application");
                    
                    // Create force application functions
                    detectedProps.thrust = function(value) {
                        selectedEntity.rigidbody.applyForce(new pc.Vec3(0, value * 10, 0));
                    };
                    detectedProps.pitch = function(value) {
                        selectedEntity.rigidbody.applyForce(selectedEntity.forward.clone().scale(-value * 10));
                    };
                    detectedProps.roll = function(value) {
                        selectedEntity.rigidbody.applyForce(selectedEntity.right.clone().scale(value * 10));
                    };
                    detectedProps.yaw = function(value) {
                        selectedEntity.rigidbody.applyTorque(new pc.Vec3(0, value * 10, 0));
                    };
                }
                
                // Check entity and its scripts for control properties
                if (selectedEntity.script) {
                    for (var scriptName in selectedEntity.script) {
                        if (!selectedEntity.script.hasOwnProperty(scriptName)) continue;
                        
                        var script = selectedEntity.script[scriptName];
                        if (!script) continue;
                        
                        log("Checking script: " + scriptName);
                        
                        // Check each property on the script
                        for (var propName in script) {
                            if (typeof script[propName] === 'function' || 
                                typeof script[propName] === 'object') continue;
                            
                            var lowerProp = propName.toLowerCase();
                            
                            // Check for thrust properties
                            if (!detectedProps.thrust && thrustProps.some(p => lowerProp.includes(p))) {
                                detectedProps.thrust = scriptName + '.' + propName;
                                thrustInput.input.value = detectedProps.thrust;
                                log("Found thrust property: " + detectedProps.thrust);
                            }
                            
                            // Check for pitch properties
                            if (!detectedProps.pitch && pitchProps.some(p => lowerProp.includes(p))) {
                                detectedProps.pitch = scriptName + '.' + propName;
                                pitchInput.input.value = detectedProps.pitch;
                                log("Found pitch property: " + detectedProps.pitch);
                            }
                            
                            // Check for roll properties
                            if (!detectedProps.roll && rollProps.some(p => lowerProp.includes(p))) {
                                detectedProps.roll = scriptName + '.' + propName;
                                rollInput.input.value = detectedProps.roll;
                                log("Found roll property: " + detectedProps.roll);
                            }
                            
                            // Check for yaw properties
                            if (!detectedProps.yaw && yawProps.some(p => lowerProp.includes(p))) {
                                detectedProps.yaw = scriptName + '.' + propName;
                                yawInput.input.value = detectedProps.yaw;
                                log("Found yaw property: " + detectedProps.yaw);
                            }
                        }
                    }
                }
                
                // Update control props
                controlProps = detectedProps;
                
                log("Auto-detection complete");
                if (!detectedProps.thrust && !detectedProps.pitch && 
                    !detectedProps.roll && !detectedProps.yaw) {
                    log("No control properties detected. Will try direct force application.", true);
                }
            });
            controlSection.appendChild(detectBtn);
            
            container.appendChild(controlSection);
            
            // Manual control section
            var manualControlSection = document.createElement('div');
            manualControlSection.style.border = '1px solid rgba(255, 255, 255, 0.2)';
            manualControlSection.style.padding = '10px';
            manualControlSection.style.borderRadius = '4px';
            manualControlSection.style.marginBottom = '15px';
            
            var manualLabel = document.createElement('div');
            manualLabel.textContent = 'Manual Control:';
            manualLabel.style.marginBottom = '10px';
            manualControlSection.appendChild(manualLabel);
            
            // Create sliders for each control
            function createControlSlider(name, min, max, step, defaultValue) {
                var container = document.createElement('div');
                container.style.marginBottom = '10px';
                
                var header = document.createElement('div');
                header.style.display = 'flex';
                header.style.justifyContent = 'space-between';
                header.style.marginBottom = '5px';
                
                var label = document.createElement('span');
                label.textContent = name;
                header.appendChild(label);
                
                var value = document.createElement('span');
                value.textContent = defaultValue.toFixed(2);
                value.style.fontFamily = 'monospace';
                header.appendChild(value);
                
                container.appendChild(header);
                
                var slider = document.createElement('input');
                slider.type = 'range';
                slider.min = min;
                slider.max = max;
                slider.step = step;
                slider.value = defaultValue;
                slider.style.width = '100%';
                slider.addEventListener('input', function() {
                    value.textContent = parseFloat(slider.value).toFixed(2);
                });
                
                container.appendChild(slider);
                
                return { container, slider, value };
            }
            
            var thrustSlider = createControlSlider('Thrust', 0, 1, 0.01, 0.5);
            var pitchSlider = createControlSlider('Pitch', -1, 1, 0.01, 0);
            var rollSlider = createControlSlider('Roll', -1, 1, 0.01, 0);
            var yawSlider = createControlSlider('Yaw', -1, 1, 0.01, 0);
            
            manualControlSection.appendChild(thrustSlider.container);
            manualControlSection.appendChild(pitchSlider.container);
            manualControlSection.appendChild(rollSlider.container);
            manualControlSection.appendChild(yawSlider.container);
            
            // Apply manual controls button
            var applyManualBtn = document.createElement('button');
            applyManualBtn.textContent = 'Apply Manual Controls';
            applyManualBtn.style.width = '100%';
            applyManualBtn.style.padding = '8px';
            applyManualBtn.style.marginTop = '5px';
            applyManualBtn.addEventListener('click', function() {
                if (!selectedEntity) {
                    log("No entity selected", true);
                    return;
                }
                
                var thrust = parseFloat(thrustSlider.slider.value);
                var pitch = parseFloat(pitchSlider.slider.value);
                var roll = parseFloat(rollSlider.slider.value);
                var yaw = parseFloat(yawSlider.slider.value);
                
                log("Applying manual controls: thrust=" + thrust.toFixed(2) + 
                    ", pitch=" + pitch.toFixed(2) + 
                    ", roll=" + roll.toFixed(2) + 
                    ", yaw=" + yaw.toFixed(2));
                
                applyControls(thrust, pitch, roll, yaw);
            });
            manualControlSection.appendChild(applyManualBtn);
            
            // Reset button
            var resetBtn = document.createElement('button');
            resetBtn.textContent = 'Reset Drone';
            resetBtn.style.width = '100%';
            resetBtn.style.padding = '8px';
            resetBtn.style.marginTop = '5px';
            resetBtn.addEventListener('click', resetDrone);
            manualControlSection.appendChild(resetBtn);
            
            container.appendChild(manualControlSection);
            
            // External control toggle
            var controlToggle = document.createElement('div');
            controlToggle.style.display = 'flex';
            controlToggle.style.alignItems = 'center';
            controlToggle.style.marginBottom = '15px';
            controlToggle.style.padding = '8px';
            controlToggle.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
            controlToggle.style.borderRadius = '4px';
            
            var controlCheckbox = document.createElement('input');
            controlCheckbox.type = 'checkbox';
            controlCheckbox.id = 'external-control';
            controlCheckbox.style.marginRight = '10px';
            controlCheckbox.disabled = true;
            controlCheckbox.addEventListener('change', function(e) {
                setExternalControl(e.target.checked);
            });
            
            var controlLabel = document.createElement('label');
            controlLabel.htmlFor = 'external-control';
            controlLabel.textContent = 'Enable External Control';
            controlLabel.style.flex = '1';
            
            controlToggle.appendChild(controlCheckbox);
            controlToggle.appendChild(controlLabel);
            container.appendChild(controlToggle);
            
            // Add to document
            document.body.appendChild(container);
            
            // Start the update loop for state updates
            setInterval(function() {
                if (connected && socket && selectedEntity) {
                    sendDroneState();
                }
            }, 100);
            
            return {
                container: container,
                statusEl: statusEl,
                connectBtn: connectBtn,
                disconnectBtn: disconnectBtn,
                controlCheckbox: controlCheckbox,
                thrustSlider: thrustSlider.slider,
                pitchSlider: pitchSlider.slider,
                rollSlider: rollSlider.slider,
                yawSlider: yawSlider.slider,
                thrustValue: thrustSlider.value,
                pitchValue: pitchSlider.value,
                rollValue: rollSlider.value,
                yawValue: yawSlider.value
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
         * Set a nested property by path
         */
        function setNestedProperty(obj, path, value) {
            if (!path || !obj) return false;
            
            // Handle 'script.name.property' format
            var parts = path.split('.');
            
            if (parts.length === 1) {
                // Direct property
                obj[parts[0]] = value;
                return true;
            }
            
            if (parts[0] === 'script' && parts.length >= 3) {
                // Script property
                var scriptName = parts[1];
                var propName = parts[2];
                
                if (obj.script && obj.script[scriptName]) {
                    obj.script[scriptName][propName] = value;
                    return true;
                }
            } else {
                // Try to navigate the path
                var current = obj;
                for (var i = 0; i < parts.length - 1; i++) {
                    if (current[parts[i]] === undefined) {
                        return false;
                    }
                    current = current[parts[i]];
                }
                current[parts[parts.length - 1]] = value;
                return true;
            }
            
            return false;
        }
        
        /**
         * Log message
         */
        function log(message, isError) {
            if (config.debug || isError) {
                console.log('[ManualDroneController] ' + message);
            }
        }
    }
})(); 