// Instead of creating the script immediately, we'll make a function that creates it
function createDroneController(app) {
    // Create the script
    const DroneController = pc.createScript('droneController');
    
    // Physics parameters
    DroneController.attributes.add('mass', { type: 'number', default: 2.0 }); // Slightly heavier
    DroneController.attributes.add('maxThrust', { type: 'number', default: 40 }); // Reduced max thrust
    DroneController.attributes.add('rotateSpeed', { type: 'number', default: 180 });
    DroneController.attributes.add('maxTiltAngle', { type: 'number', default: 30 }); // Max tilt angle
    DroneController.attributes.add('tiltSpeed', { type: 'number', default: 5 }); // How fast tilt changes
    DroneController.attributes.add('lateralForce', { type: 'number', default: 15 }); // Force for side movement
    DroneController.attributes.add('dragCoefficient', { type: 'number', default: 0.2 });
    DroneController.attributes.add('modelScale', { type: 'number', default: 0.14 });
    DroneController.attributes.add('groundHeight', { type: 'number', default: 0.5 }); // Height of ground
    DroneController.attributes.add('liftoffThreshold', { type: 'number', default: 0.25 }); // Throttle needed for liftoff
    DroneController.attributes.add('altitudeChangeSpeed', { type: 'number', default: 4.0 }); // How fast altitude changes
    DroneController.attributes.add('altitudeControlP', { type: 'number', default: 3.0 }); // Proportional control
    DroneController.attributes.add('altitudeControlD', { type: 'number', default: 2.0 }); // Derivative control
    DroneController.attributes.add('enableLogging', { type: 'boolean', default: true });
    DroneController.attributes.add('propellerSpeed', { type: 'number', default: 70000 }); // Much faster propeller speed
    
    // Initialize the controller
    DroneController.prototype.initialize = function() {
        // State management
        this.state = 'grounded'; // Start on the ground
        
        // Debug logging
        this.debugLog("Initializing drone controller");
        
        // Animation components and data
        this.animationComponents = [];
        this.modelComponents = [];
        this.animationNames = {};
        this.propellerEntities = [];
        this.manualPropellerRotation = false;
        
        // Initial propeller rotations - to preserve local orientation
        this.initialPropellerRotations = [];
        
        // Search for animation and model components
        this.findAnimationAndModelComponents();
        
        // Try to find propeller parts for manual rotation if needed
        this.findPropellers();
        
        // Physics state
        this.velocity = new pc.Vec3(0, 0, 0);
        
        // Altitude control
        this.targetAltitude = this.groundHeight;
        this.lastHeightError = 0;
        
        // Rotation values
        this.yaw = 0;
        this.pitch = 0;
        this.roll = 0;
        
        // Thrust and gravity
        this.gravity = 9.81; // m/s²
        this.thrust = 0;
        this.throttle = 0;
        
        // Control state
        this.forwardInput = 0;
        this.rightInput = 0;
        this.yawInput = 0;
        this.verticalInput = 0; // New variable for vertical control
        
        // Reusable vector objects
        this._forward = new pc.Vec3();
        this._right = new pc.Vec3();
        this._up = new pc.Vec3(0, 1, 0);
        this._targetRotation = new pc.Quat();
        this._worldForce = new pc.Vec3();
        this._acceleration = new pc.Vec3();
        
        // Create keyboard for controls
        this.keyboard = new pc.Keyboard(document.body);
        
        // Position the drone on the ground
        const pos = this.entity.getPosition();
        pos.y = this.groundHeight;
        this.entity.setPosition(pos);
        
        // Log entity hierarchy for debugging
        this.debugLog("Drone hierarchy:");
        this.logEntityHierarchy(this.entity);
    };
    
    // Logging helper
    DroneController.prototype.debugLog = function(message) {
        if (this.enableLogging) {
            console.log(message);
        }
    };
    
    // Log entity hierarchy for debugging
    DroneController.prototype.logEntityHierarchy = function(entity, indent = "") {
        this.debugLog(indent + "- " + entity.name + " [Components: " + Object.keys(entity.c || {}).join(", ") + "]");
        
        // List all components on this entity
        if (entity.animation) this.debugLog(indent + "  Has animation component");
        if (entity.model) this.debugLog(indent + "  Has model component");
        
        // Log children
        for (let i = 0; i < entity.children.length; i++) {
            this.logEntityHierarchy(entity.children[i], indent + "  ");
        }
    };
    
    // Find animation components in the entity hierarchy
    DroneController.prototype.findAnimationAndModelComponents = function() {
        // Function to recursively search entities
        const searchEntity = (entity) => {
            // Check for animation component
            if (entity.animation) {
                this.animationComponents.push(entity.animation);
                this.debugLog("Found animation component on: " + entity.name);
                
                // Check what animations are available
                const anims = Object.keys(entity.animation.animations || {});
                this.animationNames[entity.name] = anims;
                this.debugLog("  Animations: " + anims.join(", "));
            }
            
            // Check for model component
            if (entity.model) {
                this.modelComponents.push(entity.model);
                this.debugLog("Found model component on: " + entity.name);
            }
            
            // Check all children
            for (let i = 0; i < entity.children.length; i++) {
                searchEntity(entity.children[i]);
            }
        };
        
        searchEntity(this.entity);
        
        this.debugLog(`Found ${this.animationComponents.length} animation components and ${this.modelComponents.length} model components`);
        
        if (this.animationComponents.length === 0) {
            this.debugLog("No animation components found. Will try direct propeller rotation.");
            this.manualPropellerRotation = true;
        }
    };
    
    // Try to find propeller objects for manual rotation
    DroneController.prototype.findPropellers = function() {
        // Function to recursively search for likely propeller entities
        const searchPropellers = (entity) => {
            // Check if name contains "propeller" or "rotor"
            const nameLC = entity.name.toLowerCase();
            if (nameLC.includes("propeller") || nameLC.includes("rotor") || 
                nameLC.includes("prop") || nameLC.includes("blade")) {
                this.propellerEntities.push(entity);
                
                // Store the initial rotation to maintain local orientation
                this.initialPropellerRotations.push(entity.getLocalRotation().clone());
                
                this.debugLog("Found possible propeller: " + entity.name);
            }
            
            // Check all children
            for (let i = 0; i < entity.children.length; i++) {
                searchPropellers(entity.children[i]);
            }
        };
        
        searchPropellers(this.entity);
        this.debugLog(`Found ${this.propellerEntities.length} potential propeller objects`);
    };
    
    // Update the drone every frame
    DroneController.prototype.update = function(dt) {
        // Use a fixed timestep for consistent physics
        const fixedDt = Math.min(dt, 1/30);
        
        this.processInput(fixedDt);
        this.updateState();
        this.updateAltitudeControl(fixedDt);
        this.updatePhysics(fixedDt);
        this.updateRotation(fixedDt);
        this.applyMovement(fixedDt);
        this.updatePropellers(fixedDt);
    };
    
    DroneController.prototype.updatePropellers = function(dt) {
        // First try standard animations
        let animationPlayed = false;
        
        // Try to play animations if found
        if (this.animationComponents.length > 0) {
            for (let i = 0; i < this.animationComponents.length; i++) {
                const anim = this.animationComponents[i];
                const entityName = anim.entity ? anim.entity.name : "unknown";
                const availableAnims = this.animationNames[entityName] || [];
                
                if (availableAnims.length > 0) {
                    const animName = availableAnims[0];
                    
                    if (this.state === 'flying') {
                        // Make sure animation is playing when flying
                        if (!anim.currAnim) {
                            anim.loop = true;
                            anim.speed = 8.0; // Much faster animation speed (8x)
                            anim.play(animName);
                            this.debugLog(`Started animation: ${animName} on ${entityName} at speed 8.0`);
                            animationPlayed = true;
                        } else if (anim.speed !== 8.0) {
                            // Update speed if not already set
                            anim.speed = 8.0;
                        } else {
                            animationPlayed = true;
                        }
                    } else {
                        // Stop animation when on the ground
                        if (anim.currAnim) {
                            anim.stop();
                            this.debugLog(`Stopped animation on ${entityName}`);
                        }
                    }
                }
            }
        }
        
        // If no animations played and manual rotation is enabled, rotate propellers directly
        if (!animationPlayed && this.propellerEntities.length > 0) {
            const rotSpeed = this.state === 'flying' ? this.propellerSpeed : 0; // degrees per second
            
            for (let i = 0; i < this.propellerEntities.length; i++) {
                const propeller = this.propellerEntities[i];
                
                // Alternate rotation direction for adjacent propellers
                const direction = (i % 2 === 0) ? 1 : -1;
                
                // Get current local rotation
                const currentRot = propeller.getLocalRotation();
                
                // Create a rotation quaternion for Y-axis rotation
                const rotAngle = rotSpeed * direction * dt;
                const rotDelta = new pc.Quat().setFromAxisAngle(new pc.Vec3(0, 1, 0), rotAngle);
                
                // Apply rotation in local space (combined with current rotation)
                const newRot = rotDelta.mul(currentRot);
                propeller.setLocalRotation(newRot);
            }
        }
    };
    
    DroneController.prototype.processInput = function(dt) {
        // Get current input state
        this.forwardInput = this.keyboard.isPressed(pc.KEY_W) ? 1 : this.keyboard.isPressed(pc.KEY_S) ? -1 : 0;
        this.rightInput = this.keyboard.isPressed(pc.KEY_D) ? 1 : this.keyboard.isPressed(pc.KEY_A) ? -1 : 0;
        this.yawInput = this.keyboard.isPressed(pc.KEY_E) ? 1 : this.keyboard.isPressed(pc.KEY_Q) ? -1 : 0;
        
        // Vertical input - used to adjust target altitude
        this.verticalInput = this.keyboard.isPressed(pc.KEY_SPACE) ? 1 : this.keyboard.isPressed(pc.KEY_SHIFT) ? -1 : 0;
        
        // Throttle is now just for takeoff detection
        if (this.keyboard.isPressed(pc.KEY_SPACE) && this.state === 'grounded') {
            this.throttle += dt * 1.0;
        } else if (this.keyboard.isPressed(pc.KEY_SHIFT) && this.state === 'grounded') {
            this.throttle -= dt * 1.5;
        }
        
        // Clamp throttle between 0 and 1
        this.throttle = pc.math.clamp(this.throttle, 0, 1);
    };
    
    DroneController.prototype.updateState = function() {
        // Previous state for detecting transitions
        const previousState = this.state;
        
        // Check for state transitions
        if (this.state === 'grounded') {
            // Can only take off if throttle is above threshold
            if (this.throttle > this.liftoffThreshold) {
                this.state = 'flying';
                this.debugLog("Drone taking off");
                
                // Set initial target altitude slightly above ground
                this.targetAltitude = this.groundHeight + 1.0;
            }
        } else if (this.state === 'flying') {
            // Return to ground if too low and trying to descend
            const height = this.entity.getPosition().y;
            if (height <= this.groundHeight + 0.1 && this.verticalInput < 0) {
                this.state = 'grounded';
                this.velocity.set(0, 0, 0); // Stop all movement
                this.debugLog("Drone landed");
                
                // Make sure drone is exactly at ground height
                const pos = this.entity.getPosition();
                pos.y = this.groundHeight;
                this.entity.setPosition(pos);
                
                // Reset altitude target to ground
                this.targetAltitude = this.groundHeight;
                this.throttle = 0;
            }
        }
    };
    
    DroneController.prototype.updateAltitudeControl = function(dt) {
        if (this.state !== 'flying') return;
        
        // When flying, the Space and Shift keys adjust target altitude
        if (this.verticalInput !== 0) {
            // Change target altitude based on vertical input
            this.targetAltitude += this.verticalInput * this.altitudeChangeSpeed * dt;
            
            // Don't allow target to go below ground
            this.targetAltitude = Math.max(this.targetAltitude, this.groundHeight);
        }
        
        // Get current altitude
        const currentAltitude = this.entity.getPosition().y;
        
        // Calculate error (difference between target and current)
        const heightError = this.targetAltitude - currentAltitude;
        
        // Calculate derivative (rate of change of error)
        const errorDerivative = (heightError - this.lastHeightError) / dt;
        this.lastHeightError = heightError;
        
        // PD controller for thrust
        // P term: proportional to error
        // D term: reduces oscillation
        const thrustAdjustment = this.altitudeControlP * heightError + this.altitudeControlD * errorDerivative;
        
        // Calculate thrust needed to hover (counter gravity)
        const hoverThrust = this.gravity * this.mass;
        
        // Adjust thrust using PD controller and add hover thrust
        this.thrust = hoverThrust + thrustAdjustment;
        
        // Clamp thrust to reasonable values
        this.thrust = pc.math.clamp(this.thrust, 0, this.maxThrust);
    };
    
    DroneController.prototype.updatePhysics = function(dt) {
        // Only apply physics if flying
        if (this.state !== 'flying') {
            // When grounded, only allow rotation
            this.velocity.set(0, 0, 0);
            return;
        }
        
        // Get rotation quaternion for current yaw
        const yawRotation = new pc.Quat().setFromEulerAngles(0, this.yaw, 0);
        
        // Calculate basis vectors
        this._forward.set(0, 0, -1);
        this._right.set(1, 0, 0);
        
        // Transform to world space
        yawRotation.transformVector(this._forward, this._forward);
        yawRotation.transformVector(this._right, this._right);
        
        // Reset acceleration
        this._acceleration.set(0, -this.gravity, 0); // Start with gravity
        
        // Apply vertical thrust
        this._acceleration.y += this.thrust / this.mass;
        
        // Apply directional forces - SIMPLIFIED for reliability
        if (this.forwardInput !== 0) {
            // Apply forward/backward force
            this._acceleration.x += this._forward.x * this.forwardInput * this.lateralForce / this.mass;
            this._acceleration.z += this._forward.z * this.forwardInput * this.lateralForce / this.mass;
        }
        
        if (this.rightInput !== 0) {
            // Apply right/left force
            this._acceleration.x += this._right.x * this.rightInput * this.lateralForce / this.mass;
            this._acceleration.z += this._right.z * this.rightInput * this.lateralForce / this.mass;
        }
        
        // Apply simple drag - proportional to velocity
        this._acceleration.x -= this.velocity.x * this.dragCoefficient;
        this._acceleration.y -= this.velocity.y * this.dragCoefficient;
        this._acceleration.z -= this.velocity.z * this.dragCoefficient;
        
        // Update velocity
        this.velocity.x += this._acceleration.x * dt;
        this.velocity.y += this._acceleration.y * dt;
        this.velocity.z += this._acceleration.z * dt;
    };
    
    DroneController.prototype.updateRotation = function(dt) {
        // Always allow yaw rotation
        this.yaw += this.yawInput * this.rotateSpeed * dt;
        
        // Handle pitch and roll based on state
        if (this.state === 'flying') {
            // Target tilt angles based on input
            const targetPitch = -this.forwardInput * this.maxTiltAngle;
            const targetRoll = -this.rightInput * this.maxTiltAngle;
            
            // Smoothly interpolate current pitch and roll
            this.pitch = pc.math.lerp(this.pitch, targetPitch, dt * this.tiltSpeed);
            this.roll = pc.math.lerp(this.roll, targetRoll, dt * this.tiltSpeed);
        } else {
            // When grounded, gradually return to level
            this.pitch = pc.math.lerp(this.pitch, 0, dt * this.tiltSpeed * 2);
            this.roll = pc.math.lerp(this.roll, 0, dt * this.tiltSpeed * 2);
        }
        
        // Apply rotation
        this._targetRotation.setFromEulerAngles(this.pitch, this.yaw, this.roll);
        this.entity.setRotation(this._targetRotation);
    };
    
    DroneController.prototype.applyMovement = function(dt) {
        // Only move if flying or transitioning
        if (this.state === 'grounded') {
            return;
        }
        
        // Apply movement based on velocity
        this.entity.translate(this.velocity.x * dt, this.velocity.y * dt, this.velocity.z * dt);
        
        // Prevent going below ground
        if (this.entity.getPosition().y < this.groundHeight) {
            const pos = this.entity.getPosition();
            pos.y = this.groundHeight;
            this.entity.setPosition(pos);
            
            // Stop downward velocity
            if (this.velocity.y < 0) {
                this.velocity.y = 0;
            }
        }
    };
    
    return DroneController;
} 