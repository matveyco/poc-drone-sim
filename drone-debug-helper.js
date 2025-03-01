/**
 * Drone Debug Helper - Find and diagnose issues with the drone controller
 */
(function() {
    // Wait for PlayCanvas to initialize
    window.addEventListener('load', function() {
        setTimeout(initializeDebugHelper, 3000); // Wait a bit longer to ensure PlayCanvas is loaded
    });
    
    function initializeDebugHelper() {
        console.log("Starting Drone Debug Helper...");
        
        // Create a global object for debugging
        window.droneDebug = {
            entities: [],
            scripts: {},
            controllers: [],
            selectedEntity: null,
            connect: connect,
            sendCommand: sendCommand,
            inspect: inspectEntities,
            setInputs: setExternalInputs
        };
        
        // WebSocket connection
        let socket = null;
        let connected = false;
        
        // Create UI for diagnostics
        createDebugUI();
        
        // Scan for entities and controllers
        inspectEntities();
        
        /**
         * Scan the scene for entities and possible controllers
         */
        function inspectEntities() {
            if (!window.pc || !window.pc.app) {
                console.log("PlayCanvas app not found, will retry in 2 seconds");
                setTimeout(inspectEntities, 2000);
                return;
            }
            
            console.log("Scanning scene for entities...");
            
            const entities = [];
            const scripts = {};
            const controllers = [];
            
            // Start from the root and traverse all entities
            function traverse(entity, path = '') {
                const currentPath = path ? path + '/' + entity.name : entity.name;
                
                // Store basic entity info
                const entityInfo = {
                    name: entity.name,
                    path: currentPath,
                    hasRigidbody: !!entity.rigidbody,
                    scripts: [],
                    ref: entity
                };
                
                // Check if it has any scripts
                if (entity.script) {
                    for (const scriptName in entity.script) {
                        if (entity.script.hasOwnProperty(scriptName)) {
                            entityInfo.scripts.push(scriptName);
                            
                            // Keep track of all scripts we find
                            if (!scripts[scriptName]) {
                                scripts[scriptName] = [];
                            }
                            scripts[scriptName].push(entity);
                            
                            // Check if it might be a controller
                            if (scriptName.toLowerCase().includes('controller') || 
                                scriptName.toLowerCase().includes('drone') ||
                                scriptName.toLowerCase().includes('copter')) {
                                controllers.push({
                                    entity: entity,
                                    scriptName: scriptName,
                                    path: currentPath
                                });
                            }
                        }
                    }
                }
                
                entities.push(entityInfo);
                
                // Process children recursively
                for (let i = 0; i < entity.children.length; i++) {
                    traverse(entity.children[i], currentPath);
                }
            }
            
            // Traverse from root
            traverse(window.pc.app.root);
            
            // Update our global debug object
            window.droneDebug.entities = entities;
            window.droneDebug.scripts = scripts;
            window.droneDebug.controllers = controllers;
            
            // Print summary
            console.log(`Found ${entities.length} entities, ${Object.keys(scripts).length} script types, and ${controllers.length} potential controllers`);
            
            // List potential controllers
            if (controllers.length > 0) {
                console.log("Potential drone controllers found:");
                controllers.forEach((controller, index) => {
                    console.log(`[${index}] ${controller.path} - Script: ${controller.scriptName}`);
                    
                    // Inspect the script
                    const script = controller.entity.script[controller.scriptName];
                    console.log("Script methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(script))
                        .filter(method => method !== 'constructor'));
                    
                    // Try to find input properties
                    const properties = [];
                    for (const key in script) {
                        if (script.hasOwnProperty(key)) {
                            properties.push(key);
                        }
                    }
                    console.log("Script properties:", properties);
                    
                    // Check for known control properties
                    const controlProps = checkControlProperties(script);
                    console.log("Control properties found:", controlProps);
                });
            } else {
                console.log("No potential controllers found.");
                console.log("Entities with scripts:", entities.filter(e => e.scripts.length > 0).map(e => e.name + " (" + e.scripts.join(", ") + ")"));
            }
            
            // Update the select dropdown
            updateEntitySelect();
        }
        
        /**
         * Check for common control properties in a script
         */
        function checkControlProperties(script) {
            const controlProps = {
                vertical: null,
                forward: null,
                strafe: null,
                yaw: null,
                externalInputs: null
            };
            
            // Common input property names
            const verticalProps = ['upDown', 'thrust', 'throttle', 'lift', 'verticalInput', 'vertical'];
            const forwardProps = ['forwardBack', 'pitch', 'forwardInput', 'forward'];
            const strafeProps = ['leftRight', 'roll', 'strafeInput', 'strafe'];
            const yawProps = ['yaw', 'yawInput', 'rotation', 'turn'];
            
            // Check for each property type
            for (const prop in script) {
                const propLower = prop.toLowerCase();
                
                // Check for external inputs container
                if (prop === '_externalInputs' || prop === 'externalInputs') {
                    controlProps.externalInputs = prop;
                }
                
                // Check vertical properties
                for (const pattern of verticalProps) {
                    if (propLower.includes(pattern.toLowerCase())) {
                        controlProps.vertical = prop;
                        break;
                    }
                }
                
                // Check forward properties
                for (const pattern of forwardProps) {
                    if (propLower.includes(pattern.toLowerCase())) {
                        controlProps.forward = prop;
                        break;
                    }
                }
                
                // Check strafe properties
                for (const pattern of strafeProps) {
                    if (propLower.includes(pattern.toLowerCase())) {
                        controlProps.strafe = prop;
                        break;
                    }
                }
                
                // Check yaw properties
                for (const pattern of yawProps) {
                    if (propLower.includes(pattern.toLowerCase())) {
                        controlProps.yaw = prop;
                        break;
                    }
                }
            }
            
            return controlProps;
        }
        
        /**
         * Create the debug UI
         */
        function createDebugUI() {
            const container = document.createElement('div');
            container.style.position = 'fixed';
            container.style.top = '10px';
            container.style.right = '10px';
            container.style.width = '300px';
            container.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
            container.style.color = '#fff';
            container.style.padding = '10px';
            container.style.borderRadius = '5px';
            container.style.fontFamily = 'Arial, sans-serif';
            container.style.fontSize = '13px';
            container.style.zIndex = '10000';
            container.style.maxHeight = '90vh';
            container.style.overflowY = 'auto';
            
            // Title
            const title = document.createElement('div');
            title.textContent = 'Drone Debug Helper';
            title.style.fontWeight = 'bold';
            title.style.marginBottom = '10px';
            title.style.textAlign = 'center';
            title.style.fontSize = '16px';
            container.appendChild(title);
            
            // Entity select
            const selectLabel = document.createElement('div');
            selectLabel.textContent = 'Select Entity:';
            selectLabel.style.marginBottom = '5px';
            container.appendChild(selectLabel);
            
            const select = document.createElement('select');
            select.style.width = '100%';
            select.style.marginBottom = '10px';
            select.style.padding = '5px';
            select.style.backgroundColor = '#333';
            select.style.color = '#fff';
            select.style.border = '1px solid #555';
            container.appendChild(select);
            
            select.addEventListener('change', function() {
                const selectedPath = select.value;
                const entity = window.pc.app.root.findByPath(selectedPath);
                window.droneDebug.selectedEntity = entity;
                updateEntityDetails(entity);
            });
            
            // Entity details
            const detailsContainer = document.createElement('div');
            detailsContainer.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
            detailsContainer.style.padding = '10px';
            detailsContainer.style.borderRadius = '5px';
            detailsContainer.style.marginBottom = '10px';
            container.appendChild(detailsContainer);
            
            // Connection section
            const connectionContainer = document.createElement('div');
            connectionContainer.style.marginBottom = '10px';
            container.appendChild(connectionContainer);
            
            const connectBtn = document.createElement('button');
            connectBtn.textContent = 'Connect WebSocket';
            connectBtn.style.padding = '8px';
            connectBtn.style.marginRight = '5px';
            connectBtn.style.backgroundColor = '#444';
            connectBtn.style.color = '#fff';
            connectBtn.style.border = 'none';
            connectBtn.style.borderRadius = '3px';
            connectBtn.style.cursor = 'pointer';
            connectBtn.addEventListener('click', connect);
            connectionContainer.appendChild(connectBtn);
            
            const disconnectBtn = document.createElement('button');
            disconnectBtn.textContent = 'Disconnect';
            disconnectBtn.style.padding = '8px';
            disconnectBtn.style.backgroundColor = '#444';
            disconnectBtn.style.color = '#fff';
            disconnectBtn.style.border = 'none';
            disconnectBtn.style.borderRadius = '3px';
            disconnectBtn.style.cursor = 'pointer';
            disconnectBtn.disabled = true;
            disconnectBtn.addEventListener('click', disconnect);
            connectionContainer.appendChild(disconnectBtn);
            
            const wsStatus = document.createElement('div');
            wsStatus.textContent = 'WebSocket: Not Connected';
            wsStatus.style.marginTop = '5px';
            wsStatus.style.padding = '5px';
            wsStatus.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
            wsStatus.style.borderRadius = '3px';
            connectionContainer.appendChild(wsStatus);
            
            // Control section
            const controlsContainer = document.createElement('div');
            controlsContainer.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
            controlsContainer.style.padding = '10px';
            controlsContainer.style.borderRadius = '5px';
            controlsContainer.style.marginBottom = '10px';
            container.appendChild(controlsContainer);
            
            const controlsTitle = document.createElement('div');
            controlsTitle.textContent = 'Manual Controls';
            controlsTitle.style.fontWeight = 'bold';
            controlsTitle.style.marginBottom = '5px';
            controlsContainer.appendChild(controlsTitle);
            
            // Control buttons
            const controlBtns = document.createElement('div');
            controlBtns.style.display = 'grid';
            controlBtns.style.gridTemplateColumns = '1fr 1fr';
            controlBtns.style.gap = '5px';
            controlsContainer.appendChild(controlBtns);
            
            const testBtn = document.createElement('button');
            testBtn.textContent = 'Test Controls';
            testBtn.style.padding = '8px';
            testBtn.style.backgroundColor = '#444';
            testBtn.style.color = '#fff';
            testBtn.style.border = 'none';
            testBtn.style.borderRadius = '3px';
            testBtn.style.cursor = 'pointer';
            testBtn.addEventListener('click', function() {
                testControls();
            });
            controlBtns.appendChild(testBtn);
            
            const resetBtn = document.createElement('button');
            resetBtn.textContent = 'Reset Position';
            resetBtn.style.padding = '8px';
            resetBtn.style.backgroundColor = '#444';
            resetBtn.style.color = '#fff';
            resetBtn.style.border = 'none';
            resetBtn.style.borderRadius = '3px';
            resetBtn.style.cursor = 'pointer';
            resetBtn.addEventListener('click', function() {
                resetPosition();
            });
            controlBtns.appendChild(resetBtn);
            
            const upBtn = document.createElement('button');
            upBtn.textContent = 'Up';
            upBtn.style.padding = '8px';
            upBtn.style.backgroundColor = '#444';
            upBtn.style.color = '#fff';
            upBtn.style.border = 'none';
            upBtn.style.borderRadius = '3px';
            upBtn.style.cursor = 'pointer';
            upBtn.addEventListener('click', function() {
                setExternalInputs(0, 0, 0, 1);
                setTimeout(() => setExternalInputs(0, 0, 0, 0), 500);
            });
            controlBtns.appendChild(upBtn);
            
            const downBtn = document.createElement('button');
            downBtn.textContent = 'Down';
            downBtn.style.padding = '8px';
            downBtn.style.backgroundColor = '#444';
            downBtn.style.color = '#fff';
            downBtn.style.border = 'none';
            downBtn.style.borderRadius = '3px';
            downBtn.style.cursor = 'pointer';
            downBtn.addEventListener('click', function() {
                setExternalInputs(0, 0, 0, -1);
                setTimeout(() => setExternalInputs(0, 0, 0, 0), 500);
            });
            controlBtns.appendChild(downBtn);
            
            // Console output
            const consoleOutput = document.createElement('div');
            consoleOutput.style.backgroundColor = '#222';
            consoleOutput.style.padding = '10px';
            consoleOutput.style.borderRadius = '5px';
            consoleOutput.style.marginTop = '10px';
            consoleOutput.style.height = '150px';
            consoleOutput.style.overflowY = 'auto';
            consoleOutput.style.fontFamily = 'monospace';
            consoleOutput.style.fontSize = '12px';
            container.appendChild(consoleOutput);
            
            // Log function
            window.droneDebug.log = function(message, error = false) {
                const logEntry = document.createElement('div');
                logEntry.textContent = message;
                if (error) {
                    logEntry.style.color = '#ff8888';
                }
                consoleOutput.appendChild(logEntry);
                consoleOutput.scrollTop = consoleOutput.scrollHeight;
                console.log("[DroneDebug] " + message);
                
                // Keep only the latest 50 entries
                while (consoleOutput.children.length > 50) {
                    consoleOutput.removeChild(consoleOutput.firstChild);
                }
            };
            
            // Store elements for later use
            window.droneDebug.ui = {
                container: container,
                entitySelect: select,
                detailsContainer: detailsContainer,
                connectBtn: connectBtn,
                disconnectBtn: disconnectBtn,
                wsStatus: wsStatus,
                consoleOutput: consoleOutput
            };
            
            // Add to document
            document.body.appendChild(container);
            
            // Log init
            window.droneDebug.log("Drone Debug Helper initialized");
        }
        
        /**
         * Update the entity select dropdown
         */
        function updateEntitySelect() {
            const select = window.droneDebug.ui.entitySelect;
            select.innerHTML = '';
            
            // Add default option
            const defaultOption = document.createElement('option');
            defaultOption.text = '-- Select an entity --';
            defaultOption.value = '';
            select.add(defaultOption);
            
            // Get sorted entities (controllers first, then other entities with scripts)
            const controllers = window.droneDebug.controllers;
            const entitiesWithScripts = window.droneDebug.entities.filter(e => e.scripts.length > 0);
            
            // Add controller entities
            if (controllers.length > 0) {
                const controllerGroup = document.createElement('optgroup');
                controllerGroup.label = 'Controllers';
                
                controllers.forEach(controller => {
                    const option = document.createElement('option');
                    option.text = controller.path + ' (' + controller.scriptName + ')';
                    option.value = controller.path;
                    controllerGroup.appendChild(option);
                });
                
                select.add(controllerGroup);
            }
            
            // Add other entities with scripts
            if (entitiesWithScripts.length > 0) {
                const scriptsGroup = document.createElement('optgroup');
                scriptsGroup.label = 'Entities with Scripts';
                
                entitiesWithScripts.forEach(entity => {
                    // Skip if already in controllers
                    if (!controllers.some(c => c.path === entity.path)) {
                        const option = document.createElement('option');
                        option.text = entity.path + ' (' + entity.scripts.join(', ') + ')';
                        option.value = entity.path;
                        scriptsGroup.appendChild(option);
                    }
                });
                
                select.add(scriptsGroup);
            }
            
            // If we found controllers, select the first one
            if (controllers.length > 0) {
                select.value = controllers[0].path;
                window.droneDebug.selectedEntity = controllers[0].entity;
                updateEntityDetails(controllers[0].entity);
            }
        }
        
        /**
         * Update entity details
         */
        function updateEntityDetails(entity) {
            const container = window.droneDebug.ui.detailsContainer;
            container.innerHTML = '';
            
            if (!entity) {
                container.textContent = 'No entity selected';
                return;
            }
            
            // Entity name and position
            const nameEl = document.createElement('div');
            nameEl.style.fontWeight = 'bold';
            nameEl.textContent = 'Entity: ' + entity.name;
            container.appendChild(nameEl);
            
            const position = entity.getPosition();
            const posEl = document.createElement('div');
            posEl.textContent = `Position: x=${position.x.toFixed(2)}, y=${position.y.toFixed(2)}, z=${position.z.toFixed(2)}`;
            container.appendChild(posEl);
            
            // Scripts
            if (entity.script) {
                const scriptsEl = document.createElement('div');
                scriptsEl.style.marginTop = '5px';
                scriptsEl.textContent = 'Scripts: ' + Object.keys(entity.script).join(', ');
                container.appendChild(scriptsEl);
                
                // Inspect each script
                for (const scriptName in entity.script) {
                    if (entity.script.hasOwnProperty(scriptName)) {
                        const script = entity.script[scriptName];
                        
                        // Check for control properties
                        const controlProps = checkControlProperties(script);
                        
                        // If this is likely a controller, show control info
                        if (scriptName.toLowerCase().includes('controller') || 
                            Object.values(controlProps).some(v => v !== null)) {
                            
                            const controllerEl = document.createElement('div');
                            controllerEl.style.marginTop = '5px';
                            controllerEl.style.backgroundColor = 'rgba(100, 255, 100, 0.1)';
                            controllerEl.style.padding = '5px';
                            controllerEl.style.borderRadius = '3px';
                            
                            const controllerTitle = document.createElement('div');
                            controllerTitle.textContent = 'Controller: ' + scriptName;
                            controllerTitle.style.fontWeight = 'bold';
                            controllerEl.appendChild(controllerTitle);
                            
                            // Show control properties
                            const propsEl = document.createElement('div');
                            propsEl.style.marginTop = '5px';
                            propsEl.style.fontSize = '12px';
                            
                            if (controlProps.externalInputs) {
                                propsEl.innerHTML += `<div>External Inputs: <span style="color:#8f8">${controlProps.externalInputs}</span></div>`;
                            } else {
                                propsEl.innerHTML += `<div>External Inputs: <span style="color:#f88">Not Found</span></div>`;
                            }
                            
                            propsEl.innerHTML += `<div>Vertical: ${controlProps.vertical || '<span style="color:#f88">Not Found</span>'}</div>`;
                            propsEl.innerHTML += `<div>Forward: ${controlProps.forward || '<span style="color:#f88">Not Found</span>'}</div>`;
                            propsEl.innerHTML += `<div>Strafe: ${controlProps.strafe || '<span style="color:#f88">Not Found</span>'}</div>`;
                            propsEl.innerHTML += `<div>Yaw: ${controlProps.yaw || '<span style="color:#f88">Not Found</span>'}</div>`;
                            
                            controllerEl.appendChild(propsEl);
                            container.appendChild(controllerEl);
                            
                            // Look for _externalInputs
                            if (script._externalInputs) {
                                const externalInputsEl = document.createElement('div');
                                externalInputsEl.style.marginTop = '5px';
                                externalInputsEl.style.fontSize = '12px';
                                externalInputsEl.innerHTML = '<div style="color:#8f8">Found _externalInputs property</div>';
                                
                                // Show current values
                                for (const key in script._externalInputs) {
                                    if (script._externalInputs.hasOwnProperty(key) && key !== 'lastControl') {
                                        externalInputsEl.innerHTML += `<div>${key}: ${script._externalInputs[key]}</div>`;
                                    }
                                }
                                
                                controllerEl.appendChild(externalInputsEl);
                            }
                        }
                    }
                }
            }
            
            // Update position live
            const updatePosition = function() {
                if (entity && window.droneDebug.selectedEntity === entity) {
                    const pos = entity.getPosition();
                    posEl.textContent = `Position: x=${pos.x.toFixed(2)}, y=${pos.y.toFixed(2)}, z=${pos.z.toFixed(2)}`;
                    
                    requestAnimationFrame(updatePosition);
                }
            };
            
            requestAnimationFrame(updatePosition);
        }
        
        /**
         * Connect to WebSocket server
         */
        function connect() {
            const wsUrl = 'ws://localhost:8765';
            
            try {
                window.droneDebug.log("Connecting to " + wsUrl);
                window.droneDebug.ui.wsStatus.textContent = 'WebSocket: Connecting...';
                window.droneDebug.ui.wsStatus.style.backgroundColor = 'rgba(255, 165, 0, 0.2)';
                
                socket = new WebSocket(wsUrl);
                
                socket.onopen = function() {
                    connected = true;
                    window.droneDebug.log("Connected to WebSocket server");
                    window.droneDebug.ui.wsStatus.textContent = 'WebSocket: Connected';
                    window.droneDebug.ui.wsStatus.style.backgroundColor = 'rgba(0, 255, 0, 0.2)';
                    window.droneDebug.ui.connectBtn.disabled = true;
                    window.droneDebug.ui.disconnectBtn.disabled = false;
                };
                
                socket.onclose = function() {
                    connected = false;
                    window.droneDebug.log("Disconnected from WebSocket server");
                    window.droneDebug.ui.wsStatus.textContent = 'WebSocket: Disconnected';
                    window.droneDebug.ui.wsStatus.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
                    window.droneDebug.ui.connectBtn.disabled = false;
                    window.droneDebug.ui.disconnectBtn.disabled = true;
                };
                
                socket.onerror = function(error) {
                    window.droneDebug.log("WebSocket error", true);
                    console.error(error);
                    window.droneDebug.ui.wsStatus.textContent = 'WebSocket: Error';
                    window.droneDebug.ui.wsStatus.style.backgroundColor = 'rgba(255, 0, 0, 0.3)';
                };
                
                socket.onmessage = function(event) {
                    try {
                        const message = JSON.parse(event.data);
                        window.droneDebug.log("Received: " + JSON.stringify(message).substring(0, 100) + "...");
                        
                        if (message.type === 'control' && window.droneDebug.selectedEntity) {
                            // Forward to set inputs function
                            setExternalInputs(
                                message.pitch || 0,
                                message.roll || 0,
                                message.yaw || 0,
                                message.thrust || 0
                            );
                        }
                    } catch (e) {
                        window.droneDebug.log("Error parsing message: " + e, true);
                    }
                };
            } catch (e) {
                window.droneDebug.log("Error connecting: " + e, true);
                window.droneDebug.ui.wsStatus.textContent = 'WebSocket: Connection Failed';
                window.droneDebug.ui.wsStatus.style.backgroundColor = 'rgba(255, 0, 0, 0.3)';
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
                window.droneDebug.ui.wsStatus.textContent = 'WebSocket: Disconnected';
                window.droneDebug.ui.wsStatus.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
                window.droneDebug.ui.connectBtn.disabled = false;
                window.droneDebug.ui.disconnectBtn.disabled = true;
            }
        }
        
        /**
         * Send a command through WebSocket
         */
        function sendCommand(type, data) {
            if (!socket || !connected) {
                window.droneDebug.log("Cannot send command: Not connected", true);
                return false;
            }
            
            try {
                const message = {
                    type: type,
                    ...data,
                    timestamp: Date.now()
                };
                
                socket.send(JSON.stringify(message));
                window.droneDebug.log("Sent: " + JSON.stringify(message));
                return true;
            } catch (e) {
                window.droneDebug.log("Error sending command: " + e, true);
                return false;
            }
        }
        
        /**
         * Set external inputs on the controller
         */
        function setExternalInputs(pitch, roll, yaw, thrust) {
            const entity = window.droneDebug.selectedEntity;
            if (!entity) {
                window.droneDebug.log("No entity selected", true);
                return false;
            }
            
            // Try to find a controller script
            let controllerScript = null;
            let externalInputs = null;
            
            for (const scriptName in entity.script) {
                if (entity.script.hasOwnProperty(scriptName)) {
                    const script = entity.script[scriptName];
                    
                    // Check if it has _externalInputs property
                    if (script._externalInputs) {
                        controllerScript = script;
                        externalInputs = script._externalInputs;
                        break;
                    }
                    
                    // Or if it might be a controller by name
                    if (scriptName.toLowerCase().includes('controller') || 
                        scriptName.toLowerCase().includes('drone') ||
                        scriptName.toLowerCase().includes('copter')) {
                        controllerScript = script;
                    }
                }
            }
            
            if (!controllerScript) {
                window.droneDebug.log("No controller script found", true);
                return false;
            }
            
            try {
                // If we found the _externalInputs property
                if (externalInputs) {
                    // Map inputs based on property names
                    if (typeof externalInputs.forwardBack !== 'undefined') {
                        externalInputs.forwardBack = -pitch; // Negative because forward is usually negative Z
                    }
                    
                    if (typeof externalInputs.leftRight !== 'undefined') {
                        externalInputs.leftRight = roll;
                    }
                    
                    if (typeof externalInputs.yaw !== 'undefined') {
                        externalInputs.yaw = yaw;
                    }
                    
                    if (typeof externalInputs.upDown !== 'undefined') {
                        externalInputs.upDown = thrust;
                    }
                    
                    // Update the last control time
                    externalInputs.lastControl = Date.now();
                    
                    window.droneDebug.log(`Applied inputs to _externalInputs: pitch=${pitch}, roll=${roll}, yaw=${yaw}, thrust=${thrust}`);
                    return true;
                } 
                // If we need to create the _externalInputs property
                else {
                    controllerScript._externalInputs = {
                        forwardBack: -pitch,
                        leftRight: roll,
                        yaw: yaw,
                        upDown: thrust,
                        lastControl: Date.now()
                    };
                    
                    window.droneDebug.log(`Created _externalInputs on controller: pitch=${pitch}, roll=${roll}, yaw=${yaw}, thrust=${thrust}`);
                    
                    // Re-scan to update the UI
                    updateEntityDetails(entity);
                    return true;
                }
            } catch (e) {
                window.droneDebug.log("Error setting inputs: " + e, true);
                return false;
            }
        }
        
        /**
         * Test controls by applying a sequence of inputs
         */
        function testControls() {
            window.droneDebug.log("Testing controls...");
            
            const entity = window.droneDebug.selectedEntity;
            if (!entity) {
                window.droneDebug.log("No entity selected", true);
                return;
            }
            
            // Sequence of test commands
            const sequence = [
                { action: "Lift off", thrust: 1, duration: 2000 },
                { action: "Hover", thrust: 0.7, duration: 1000 },
                { action: "Move forward", pitch: -1, thrust: 0.7, duration: 1000 },
                { action: "Move back", pitch: 1, thrust: 0.7, duration: 1000 },
                { action: "Move right", roll: 1, thrust: 0.7, duration: 1000 },
                { action: "Move left", roll: -1, thrust: 0.7, duration: 1000 },
                { action: "Yaw right", yaw: 1, thrust: 0.7, duration: 1000 },
                { action: "Yaw left", yaw: -1, thrust: 0.7, duration: 1000 },
                { action: "Hover", thrust: 0.7, duration: 1000 },
                { action: "Land", thrust: -0.5, duration: 2000 },
                { action: "Stop", thrust: 0, duration: 500 }
            ];
            
            // Run the sequence
            let index = 0;
            function runSequence() {
                if (index >= sequence.length) {
                    window.droneDebug.log("Test sequence complete");
                    return;
                }
                
                const command = sequence[index];
                window.droneDebug.log(command.action);
                
                setExternalInputs(
                    command.pitch || 0,
                    command.roll || 0,
                    command.yaw || 0,
                    command.thrust || 0
                );
                
                index++;
                setTimeout(runSequence, command.duration);
            }
            
            runSequence();
        }
        
        /**
         * Reset drone position
         */
        function resetPosition() {
            const entity = window.droneDebug.selectedEntity;
            if (!entity) {
                window.droneDebug.log("No entity selected", true);
                return;
            }
            
            try {
                // Reset position and rotation
                entity.setPosition(0, 1, 0);
                entity.setEulerAngles(0, 180, 0);
                
                // Reset velocities if it has a rigidbody
                if (entity.rigidbody) {
                    entity.rigidbody.linearVelocity = new pc.Vec3(0, 0, 0);
                    entity.rigidbody.angularVelocity = new pc.Vec3(0, 0, 0);
                }
                
                window.droneDebug.log("Reset position");
            } catch (e) {
                window.droneDebug.log("Error resetting position: " + e, true);
            }
        }
    }
})(); 