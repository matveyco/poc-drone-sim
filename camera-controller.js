// Ensure script is properly initialized by wrapping in a function
function createCameraController(app) {
    var CameraController = pc.createScript('cameraController');
    
    // Camera modes
    CameraController.MODE_FREE = 0;
    CameraController.MODE_TOP = 1;
    CameraController.MODE_FOLLOW = 2;
    CameraController.MODE_FPV = 3;
    
    // Configuration attributes
    CameraController.attributes.add('droneEntity', { type: 'entity' });
    CameraController.attributes.add('distance', { type: 'number', default: 15 });
    CameraController.attributes.add('height', { type: 'number', default: 5 });
    CameraController.attributes.add('orbitSensitivity', { type: 'number', default: 0.3 });
    CameraController.attributes.add('panSensitivity', { type: 'number', default: 0.1 });
    CameraController.attributes.add('zoomSensitivity', { type: 'number', default: 0.2 });
    
    // Initialize
    CameraController.prototype.initialize = function() {
        console.log("Camera controller initializing - with true 3D orbit");
        
        // Set initial mode to free camera
        this.mode = CameraController.MODE_FREE;
        
        // Set angle parameters - but we'll use direct positioning for init
        this.yaw = 0;
        this.pitch = -45;  
        this.currentDistance = 25;
        
        // Find drone if not set
        if (!this.droneEntity) {
            this.droneEntity = this.app.root.findByName('Drone');
        }
        
        // Get drone position or use origin
        if (this.droneEntity) {
            this.targetPosition = this.droneEntity.getPosition().clone();
            console.log("Found drone at position:", this.targetPosition);
        } else {
            this.targetPosition = new pc.Vec3(0, 0, 0);
            console.log("No drone found, using origin");
        }
        
        // Set initial camera position
        this.setFixedStartingPosition();
        
        // Set up mouse controls
        this.initMouseControls();
        
        // Set up keyboard controls (as fallback)
        this.keyboard = new pc.Keyboard(window);
        
        // UI elements
        this.createModeDisplay();
        this.updateModeDisplay();
        
        // Add debug UI to show orbit angles
        this.createDebugDisplay();
    };
    
    // Create debug display for orbital parameters
    CameraController.prototype.createDebugDisplay = function() {
        this.debugDisplay = document.createElement('div');
        this.debugDisplay.style.position = 'absolute';
        this.debugDisplay.style.left = '10px';
        this.debugDisplay.style.bottom = '10px';
        this.debugDisplay.style.backgroundColor = 'rgba(0,0,0,0.5)';
        this.debugDisplay.style.color = 'white';
        this.debugDisplay.style.padding = '5px';
        this.debugDisplay.style.fontFamily = 'monospace';
        this.debugDisplay.style.fontSize = '12px';
        this.debugDisplay.style.pointerEvents = 'none';
        document.body.appendChild(this.debugDisplay);
        
        // Update debug display with current orbital parameters
        this.updateDebugDisplay();
    };
    
    // Update debug display
    CameraController.prototype.updateDebugDisplay = function() {
        if (!this.debugDisplay) return;
        
        const pos = this.entity.getPosition();
        this.debugDisplay.innerHTML = `
            Mode: ${this.getModeLabel()}<br>
            Yaw: ${this.yaw.toFixed(1)}°<br>
            Pitch: ${this.pitch.toFixed(1)}°<br>
            Distance: ${this.currentDistance.toFixed(1)}<br>
            Camera: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})
        `;
    };
    
    // Get mode label for display
    CameraController.prototype.getModeLabel = function() {
        switch (this.mode) {
            case CameraController.MODE_FREE: return "Free Orbit";
            case CameraController.MODE_TOP: return "Top View";
            case CameraController.MODE_FOLLOW: return "Follow";
            case CameraController.MODE_FPV: return "First Person";
            default: return "Unknown";
        }
    };
    
    // FIXED starting position that works reliably
    CameraController.prototype.setFixedStartingPosition = function() {
        // Start from drone position
        const dronePos = this.targetPosition.clone();
        
        // Set camera position at an absolute offset from drone
        // Positioned above and behind for a good view
        this.entity.setPosition(
            dronePos.x ,   // Offset back in X
            dronePos.y - 15,   // 15 units above drone
            dronePos.z + 15    // Offset back in Z
        );
        
        // Look directly at drone position
        this.entity.lookAt(dronePos);
        
        // Store these values for free camera mode
        const pos = this.entity.getPosition();
        
        // Calculate back to spherical coordinates for free camera
        const dx = pos.x - dronePos.x;
        const dy = pos.y - dronePos.y;
        const dz = pos.z - dronePos.z;
        
        // Use actual position to compute real distance
        this.currentDistance = Math.sqrt(dx*dx + dy*dy + dz*dz);
        
        // Update yaw/pitch based on actual position
        this.yaw = Math.atan2(dx, dz) * 180 / Math.PI;
        const hDist = Math.sqrt(dx*dx + dz*dz);
        this.pitch = -Math.atan2(dy, hDist) * 180 / Math.PI;
        
        console.log("Fixed camera position at:", pos, "with angles:", this.yaw, this.pitch);
    };
    
    // Initialize mouse controls
    CameraController.prototype.initMouseControls = function() {
        // Mouse state tracking
        this.mouse = {
            // Button states
            isLeftPressed: false,
            isRightPressed: false,
            isMiddlePressed: false,
            
            // Last position
            lastX: 0,
            lastY: 0,
            
            // Movement delta
            dx: 0,
            dy: 0
        };
        
        // Get canvas element for attaching listeners
        const canvas = this.app.graphicsDevice.canvas;
        
        // Mouse down handler
        canvas.addEventListener('mousedown', (e) => {
            // Prevent default browser behavior
            e.preventDefault();
            
            // Track button states
            switch (e.button) {
                case 0: this.mouse.isLeftPressed = true; break;     // Left
                case 1: this.mouse.isMiddlePressed = true; break;   // Middle
                case 2: this.mouse.isRightPressed = true; break;    // Right
            }
            
            // Store initial position
            this.mouse.lastX = e.clientX;
            this.mouse.lastY = e.clientY;
            
            // Update cursor style based on operation
            if (this.mouse.isLeftPressed) {
                canvas.style.cursor = 'move';
            } else if (this.mouse.isRightPressed) {
                canvas.style.cursor = 'grabbing';
            }
        });
        
        // Mouse move handler
        canvas.addEventListener('mousemove', (e) => {
            // Calculate delta
            const dx = e.clientX - this.mouse.lastX;
            const dy = e.clientY - this.mouse.lastY;
            
            // Only process in free camera mode
            if (this.mode === CameraController.MODE_FREE) {
                // Left button = orbit camera - now with full 360° freedom
                if (this.mouse.isLeftPressed) {
                    // Adjust yaw (horizontal rotation)
                    this.yaw -= dx * this.orbitSensitivity;
                    
                    // Allow full vertical rotation with minor constraint to prevent gimbal lock
                    // Allow looking from any angle above or below
                    this.pitch = Math.max(-89.9, Math.min(89.9, this.pitch + dy * this.orbitSensitivity));
                    
                    // Update camera position based on new angles
                    this.updateFreeCameraPosition();
                    
                    // Update debug display with new values
                    this.updateDebugDisplay();
                }
                
                // Right button = pan camera
                if (this.mouse.isRightPressed) {
                    this.panCamera(dx, dy);
                    this.updateDebugDisplay();
                }
            }
            
            // Update last position
            this.mouse.lastX = e.clientX;
            this.mouse.lastY = e.clientY;
        });
        
        // Mouse up handler
        canvas.addEventListener('mouseup', (e) => {
            // Reset button states
            switch (e.button) {
                case 0: this.mouse.isLeftPressed = false; break;    // Left
                case 1: this.mouse.isMiddlePressed = false; break;  // Middle
                case 2: this.mouse.isRightPressed = false; break;   // Right
            }
            
            // Reset cursor
            canvas.style.cursor = 'default';
        });
        
        // Mouse leave handler
        canvas.addEventListener('mouseleave', () => {
            // Reset all button states
            this.mouse.isLeftPressed = false;
            this.mouse.isRightPressed = false;
            this.mouse.isMiddlePressed = false;
            
            // Reset cursor
            canvas.style.cursor = 'default';
        });
        
        // Context menu handler (prevent right-click menu)
        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
        
        // Mouse wheel handler
        canvas.addEventListener('wheel', (e) => {
            // Prevent default browser behavior
            e.preventDefault();
            
            // Only process in free camera mode
            if (this.mode === CameraController.MODE_FREE) {
                // Get normalized wheel delta 
                const delta = Math.sign(e.deltaY);
                
                // Adjust zoom speed based on distance
                const zoomSpeed = Math.max(0.5, this.currentDistance * 0.05);
                
                // Update distance
                this.currentDistance = Math.max(1, Math.min(100, this.currentDistance + delta * zoomSpeed));
                
                // Update camera position
                this.updateFreeCameraPosition();
                
                // Update debug display
                this.updateDebugDisplay();
            }
        });
    };
    
    // Pan camera with right mouse drag
    CameraController.prototype.panCamera = function(dx, dy) {
        // Skip if we don't have a valid camera
        if (!this.entity.camera) return;
        
        // Get camera's orientation
        const rot = this.entity.getRotation();
        
        // Get right and up vectors
        const right = new pc.Vec3();
        const up = new pc.Vec3(0, 1, 0);
        
        // Extract right vector from rotation matrix
        rot.transformVector(pc.Vec3.RIGHT, right);
        
        // Scale movement by sensitivity
        const scale = this.currentDistance * this.panSensitivity * 0.1;
        
        // Move target position
        this.targetPosition.sub(right.scale(dx * scale));
        this.targetPosition.add(up.scale(dy * scale));
        
        // Update camera position based on new target
        this.updateFreeCameraPosition();
    };
    
    // Update free camera position based on orbit parameters
    CameraController.prototype.updateFreeCameraPosition = function() {
        // Convert yaw and pitch from degrees to radians
        const yawRad = this.yaw * Math.PI / 180;
        const pitchRad = this.pitch * Math.PI / 180;
        
        // Calculate position using spherical coordinates
        const x = Math.sin(yawRad) * Math.cos(pitchRad);
        const y = Math.sin(pitchRad);
        const z = Math.cos(yawRad) * Math.cos(pitchRad);
        
        // Scale by distance and offset by target position
        const position = new pc.Vec3(
            this.targetPosition.x + x * this.currentDistance,
            this.targetPosition.y + y * this.currentDistance,
            this.targetPosition.z + z * this.currentDistance
        );
        
        // Set camera position
        this.entity.setPosition(position);
        
        // Look at target
        this.entity.lookAt(this.targetPosition);
    };
    
    // Main update loop
    CameraController.prototype.update = function(dt) {
        // Mode switching with keyboard (1-4 keys)
        if (this.keyboard.wasPressed(pc.KEY_1)) {
            this.setMode(CameraController.MODE_FREE);
        } else if (this.keyboard.wasPressed(pc.KEY_2)) {
            this.setMode(CameraController.MODE_TOP);
        } else if (this.keyboard.wasPressed(pc.KEY_3)) {
            this.setMode(CameraController.MODE_FOLLOW);
        } else if (this.keyboard.wasPressed(pc.KEY_4)) {
            this.setMode(CameraController.MODE_FPV);
        }
        
        // Always track drone position in free camera mode if we're not actively controlling it
        if (this.mode === CameraController.MODE_FREE && this.droneEntity && 
            !this.mouse.isLeftPressed && !this.mouse.isRightPressed) {
            // Smoothly update target to follow drone
            const dronePos = this.droneEntity.getPosition();
            this.targetPosition.lerp(this.targetPosition, dronePos, dt * 2);
            this.updateFreeCameraPosition();
        }
        
        // Update camera based on current mode
        switch (this.mode) {
            case CameraController.MODE_FREE:
                // Most free camera controls handled by mouse events
                // Handle keyboard fallbacks
                this.updateFreeCameraKeyboard(dt);
                break;
                
            case CameraController.MODE_TOP:
                this.updateTopView();
                break;
                
            case CameraController.MODE_FOLLOW:
                this.updateFollowView();
                break;
                
            case CameraController.MODE_FPV:
                this.updateFpvView();
                break;
        }
        
        // Occasionally update debug display
        if (Math.random() < 0.05) {
            this.updateDebugDisplay();
        }
    };
    
    // Update free camera with keyboard fallback controls
    CameraController.prototype.updateFreeCameraKeyboard = function(dt) {
        // Only process keyboard if mouse isn't being used
        if (this.mouse.isLeftPressed || this.mouse.isRightPressed || this.mouse.isMiddlePressed) {
            return;
        }
        
        // Move target with IJKL
        const moveSpeed = 10 * dt;
        if (this.keyboard.isPressed(pc.KEY_I)) {
            this.targetPosition.z -= moveSpeed;
        }
        if (this.keyboard.isPressed(pc.KEY_K)) {
            this.targetPosition.z += moveSpeed;
        }
        if (this.keyboard.isPressed(pc.KEY_J)) {
            this.targetPosition.x -= moveSpeed;
        }
        if (this.keyboard.isPressed(pc.KEY_L)) {
            this.targetPosition.x += moveSpeed;
        }
        
        // Rotate with arrow keys
        const rotateSpeed = 90 * dt;
        if (this.keyboard.isPressed(pc.KEY_LEFT)) {
            this.yaw -= rotateSpeed;
        }
        if (this.keyboard.isPressed(pc.KEY_RIGHT)) {
            this.yaw += rotateSpeed;
        }
        if (this.keyboard.isPressed(pc.KEY_UP)) {
            // Allow full vertical rotation with arrow keys too
            this.pitch = Math.min(89.9, this.pitch + rotateSpeed);
        }
        if (this.keyboard.isPressed(pc.KEY_DOWN)) {
            this.pitch = Math.max(-89.9, this.pitch - rotateSpeed);
        }
        
        // Zoom with U/O
        const zoomSpeed = 10 * dt;
        if (this.keyboard.isPressed(pc.KEY_U)) {
            this.currentDistance = Math.max(1, this.currentDistance - zoomSpeed);
        }
        if (this.keyboard.isPressed(pc.KEY_O)) {
            this.currentDistance = Math.min(100, this.currentDistance + zoomSpeed);
        }
        
        // Update position
        this.updateFreeCameraPosition();
        
        // Update debug display
        this.updateDebugDisplay();
    };
    
    // Set camera mode
    CameraController.prototype.setMode = function(mode) {
        // Don't do anything if mode hasn't changed
        if (this.mode === mode) return;
        
        // Set new mode
        this.mode = mode;
        
        // Update display
        this.updateModeDisplay();
        this.updateDebugDisplay();
        
        console.log("Camera mode changed to:", this.getModeLabel());
    };
    
    // Create a simple mode display
    CameraController.prototype.createModeDisplay = function() {
        this.modeDisplay = document.createElement('div');
        this.modeDisplay.style.position = 'absolute';
        this.modeDisplay.style.left = '10px';
        this.modeDisplay.style.top = '10px';
        this.modeDisplay.style.backgroundColor = 'rgba(0,0,0,0.5)';
        this.modeDisplay.style.color = 'white';
        this.modeDisplay.style.padding = '5px 10px';
        this.modeDisplay.style.borderRadius = '3px';
        this.modeDisplay.style.fontFamily = 'monospace';
        this.modeDisplay.style.fontSize = '14px';
        this.modeDisplay.style.transition = 'opacity 0.5s';
        document.body.appendChild(this.modeDisplay);
        
        // Auto-hide after 3 seconds
        this.modeDisplayTimeout = null;
    };
    
    // Update mode display
    CameraController.prototype.updateModeDisplay = function() {
        if (!this.modeDisplay) return;
        
        // Update mode display text
        this.modeDisplay.textContent = `Camera: ${this.getModeLabel()} (Press 1-4 to change)`;
        
        // Show display
        this.modeDisplay.style.opacity = '1';
        
        // Auto-hide after 3 seconds
        if (this.modeDisplayTimeout) {
            clearTimeout(this.modeDisplayTimeout);
        }
        this.modeDisplayTimeout = setTimeout(() => {
            this.modeDisplay.style.opacity = '0';
        }, 3000);
    };
    
    // Update top view camera
    CameraController.prototype.updateTopView = function() {
        if (!this.droneEntity) return;
        
        const dronePos = this.droneEntity.getPosition();
        this.entity.setPosition(dronePos.x, dronePos.y + 15, dronePos.z);
        this.entity.setEulerAngles(90, 0, 0);
        
        this.updateDebugDisplay();
    };
    
    // Update follow view camera
    CameraController.prototype.updateFollowView = function() {
        if (!this.droneEntity) return;
        
        const dronePos = this.droneEntity.getPosition();
        const droneRot = this.droneEntity.getRotation();
        
        // Position camera behind drone
        const offset = new pc.Vec3(0, this.height, 10);
        droneRot.transformVector(offset, offset);
        
        this.entity.setPosition(
            dronePos.x + offset.x,
            dronePos.y + offset.y,
            dronePos.z + offset.z
        );
        
        this.entity.lookAt(dronePos);
        
        this.updateDebugDisplay();
    };
    
    // Update first person view
    CameraController.prototype.updateFpvView = function() {
        if (!this.droneEntity) return;
        
        const dronePos = this.droneEntity.getPosition();
        const droneRot = this.droneEntity.getRotation();
        
        // First person position
        const offset = new pc.Vec3(0, 0.5, 0);
        droneRot.transformVector(offset, offset);
        
        this.entity.setPosition(
            dronePos.x + offset.x, 
            dronePos.y + offset.y, 
            dronePos.z + offset.z
        );
        
        this.entity.setRotation(droneRot);
        
        this.updateDebugDisplay();
    };
    
    // Clean up when script is destroyed
    CameraController.prototype.destroy = function() {
        if (this.modeDisplay && this.modeDisplay.parentNode) {
            this.modeDisplay.parentNode.removeChild(this.modeDisplay);
        }
        if (this.debugDisplay && this.debugDisplay.parentNode) {
            this.debugDisplay.parentNode.removeChild(this.debugDisplay);
        }
    };
    
    return CameraController;
} 