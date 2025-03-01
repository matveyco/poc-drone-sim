// Instead of creating the script immediately, we'll make a function that creates it
function createDroneController(app) {
    // Create the script
    const DroneController = pc.createScript('droneController');
    
    // Basic parameters
    DroneController.attributes.add('speed', { type: 'number', default: 10 });
    DroneController.attributes.add('turnSpeed', { type: 'number', default: 120 });
    DroneController.attributes.add('verticalSpeed', { type: 'number', default: 8 }); // Faster vertical speed
    DroneController.attributes.add('tiltAngle', { type: 'number', default: 20 });
    DroneController.attributes.add('groundHeight', { type: 'number', default: 0.5 });
    DroneController.attributes.add('propellerSpeed', { type: 'number', default: 70000 });
    
    // Initialize the controller
    DroneController.prototype.initialize = function() {
        console.log("Initializing drone controller with direct vertical controls");
        
        // Initialize orientation - EXPLICITLY rotate to face forward (not toward camera)
        this.yawAngle = 180; // Start facing forward (away from camera)
        this.pitchAngle = 0;
        this.rollAngle = 0;
        this.entity.setEulerAngles(this.pitchAngle, this.yawAngle, this.rollAngle);
        console.log("Set drone to face forward (180 degrees)");
        
        // State tracking - we'll consider flying if we're above ground level
        this.isFlying = false;
        this._moveDir = new pc.Vec3();
        
        // Animation components
        this.findAnimationComponents();
        this.findPropellers();
        
        // Position at ground height initially
        const pos = this.entity.getPosition();
        pos.y = this.groundHeight;
        this.entity.setPosition(pos);
        
        // Controls
        this.keyboard = new pc.Keyboard(document.body);
        
        // Initialize velocity
        this.velocity = new pc.Vec3(0, 0, 0);
        
        // Set up physics properties
        this.maxSpeed = 10;
        this.acceleration = 5;
        this.drag = 0.95;
        this.rotationSpeed = 50;
        this.liftSpeed = 5;
        
        // External control inputs
        this._externalInputs = {
            upDown: 0,      // Vertical control (Space/Shift)
            forwardBack: 0, // Forward/Back control (W/S)
            leftRight: 0,   // Left/Right control (A/D)
            yaw: 0,         // Yaw control (Q/E)
            lastControl: 0  // Timestamp of last external control
        }; 

        // Position the drone at the start position if available
        if (app.globals && app.globals.startPosition) {
            const startPos = app.globals.startPosition;
            this.entity.setPosition(startPos.x, 1.5, startPos.z);
        }
    };
    
    // Find animation components
    DroneController.prototype.findAnimationComponents = function() {
        this.animationComponents = [];
        this.animationNames = {};
        
        const searchEntity = (entity) => {
            if (entity.animation) {
                this.animationComponents.push(entity.animation);
                console.log("Found animation on:", entity.name);
                
                // Store animation names
                const anims = Object.keys(entity.animation.animations || {});
                this.animationNames[entity.name] = anims;
                console.log("Available animations:", anims.join(", "));
            }
            
            // Check children
            for (let i = 0; i < entity.children.length; i++) {
                searchEntity(entity.children[i]);
            }
        };
        
        searchEntity(this.entity);
    };
    
    // Find propeller entities
    DroneController.prototype.findPropellers = function() {
        this.propellerEntities = [];
        
        const searchPropellers = (entity) => {
            const nameLC = entity.name.toLowerCase();
            if (nameLC.includes("propeller") || nameLC.includes("rotor") || 
                nameLC.includes("prop") || nameLC.includes("blade")) {
                this.propellerEntities.push(entity);
                console.log("Found propeller:", entity.name);
            }
            
            // Check children
            for (let i = 0; i < entity.children.length; i++) {
                searchPropellers(entity.children[i]);
            }
        };
        
        searchPropellers(this.entity);
    };
    
    // Update method called each frame
    DroneController.prototype.update = function(dt) {
        this.processInput(dt);
        this.updateOrientation(dt);
        this.updatePropellers(dt);
        
        // Check if we're flying (above ground level)
        this.isFlying = this.entity.getPosition().y > this.groundHeight + 0.1;
    };
    
    DroneController.prototype.processInput = function(dt) {
        // Variables to store input values
        let forwardInput = 0;
        let rightInput = 0;
        let yawInput = 0;
        let verticalInput = 0;
        
        // Check if we have fresh external inputs (less than 1 second old)
        const externalControlActive = this._externalInputs && 
                                     (Date.now() - this._externalInputs.lastControl < 1000);
        
        if (externalControlActive) {
            // Use external inputs
            forwardInput = this._externalInputs.forwardBack;
            rightInput = this._externalInputs.leftRight;
            yawInput = this._externalInputs.yaw;
            verticalInput = this._externalInputs.upDown;
            
            // Optional: log that we're using external controls (uncomment if needed)
            // console.log("Using external controls:", forwardInput, rightInput, yawInput, verticalInput);
        } else {
            // Use keyboard inputs as before
            if (this.keyboard.isPressed(pc.KEY_S)) forwardInput += 1;
            if (this.keyboard.isPressed(pc.KEY_W)) forwardInput -= 1;
            
            if (this.keyboard.isPressed(pc.KEY_A)) rightInput += 1;
            if (this.keyboard.isPressed(pc.KEY_D)) rightInput -= 1;
            
            if (this.keyboard.isPressed(pc.KEY_Q)) yawInput += 1;
            if (this.keyboard.isPressed(pc.KEY_E)) yawInput -= 1;
            
            if (this.keyboard.isPressed(pc.KEY_SPACE)) verticalInput += 1;
            if (this.keyboard.isPressed(pc.KEY_SHIFT)) verticalInput -= 1;
        }
        
        // Update orientation
        if (yawInput !== 0) {
            this.yawAngle += yawInput * this.turnSpeed * dt;
            
            // Keep yaw angle in 0-360 range for clarity
            while (this.yawAngle >= 360) this.yawAngle -= 360;
            while (this.yawAngle < 0) this.yawAngle += 360;
        }
        
        // Visual tilt when moving
        const targetPitch = this.isFlying ? -forwardInput * this.tiltAngle : 0;
        const targetRoll = this.isFlying ? rightInput * this.tiltAngle : 0;
        
        // Smoothly interpolate pitch and roll for visual effect
        this.pitchAngle = pc.math.lerp(this.pitchAngle, targetPitch, dt * 5);
        this.rollAngle = pc.math.lerp(this.rollAngle, targetRoll, dt * 5);
        
        // Apply all rotation angles
        this.entity.setEulerAngles(this.pitchAngle, this.yawAngle, this.rollAngle);
        
        // Movement - forward/back and left/right
        this._moveDir.set(0, 0, 0);
        
        if (forwardInput !== 0) {
            this._moveDir.z -= forwardInput;
        }
        
        if (rightInput !== 0) {
            this._moveDir.x += rightInput;
        }
        
        // Only allow horizontal movement if we're flying
        if (this.isFlying && this._moveDir.length() > 0) {
            this._moveDir.normalize();
            this._moveDir.scale(this.speed * dt);
            this.entity.translateLocal(this._moveDir.x, 0, this._moveDir.z);
        }
        
        // DIRECT VERTICAL MOVEMENT
        if (verticalInput !== 0) {
            // Get current position
            const pos = this.entity.getPosition();
            
            // Apply vertical movement directly
            pos.y += verticalInput * this.verticalSpeed * dt;
            
            // Ensure we don't go below ground level
            if (pos.y < this.groundHeight) {
                pos.y = this.groundHeight;
            }
            
            // Update position
            this.entity.setPosition(pos);
            
            // Start propellers when moving upward
            if (verticalInput > 0 && !this.isFlying) {
                this.isFlying = true;
            }
        } else if (!this.isFlying) {
            // If we're not flying and not pressing vertical controls,
            // make sure we're exactly at ground height
            const pos = this.entity.getPosition();
            if (Math.abs(pos.y - this.groundHeight) > 0.01) {
                pos.y = this.groundHeight;
                this.entity.setPosition(pos);
            }
        }
    };
    
    DroneController.prototype.updateOrientation = function(dt) {
        // Visual stabilization when not providing input
        if (!this.isFlying) {
            const rot = this.entity.getEulerAngles();
            if (Math.abs(rot.x) > 0.1 || Math.abs(rot.z) > 0.1) {
                // Gradually return to level orientation
                this.pitchAngle = pc.math.lerp(this.pitchAngle, 0, dt * 3);
                this.rollAngle = pc.math.lerp(this.rollAngle, 0, dt * 3);
                this.entity.setEulerAngles(this.pitchAngle, this.yawAngle, this.rollAngle);
            }
        }
    };
    
    DroneController.prototype.updatePropellers = function(dt) {
        // Determine if propellers should spin - now based on isFlying state
        // or if we're actively moving upward
        const shouldSpin = this.isFlying || this.keyboard.isPressed(pc.KEY_SPACE);
        
        // Update animations if available
        let animationPlayed = false;
        for (let i = 0; i < this.animationComponents.length; i++) {
            const anim = this.animationComponents[i];
            const entityName = anim.entity ? anim.entity.name : "unknown";
            const availableAnims = this.animationNames[entityName] || [];
            
            if (availableAnims.length > 0) {
                const animName = availableAnims[0];
                
                if (shouldSpin) {
                    if (!anim.currAnim) {
                        anim.loop = true;
                        anim.speed = 8.0;
                        anim.play(animName);
                        animationPlayed = true;
                    } else {
                        animationPlayed = true;
                    }
                } else {
                    if (anim.currAnim) {
                        anim.stop();
                    }
                }
            }
        }
        
        // Manual propeller rotation if no animations
        if (!animationPlayed && this.propellerEntities.length > 0) {
            const rotSpeed = shouldSpin ? this.propellerSpeed * dt : 0;
            
            for (let i = 0; i < this.propellerEntities.length; i++) {
                const propeller = this.propellerEntities[i];
                const direction = (i % 2 === 0) ? 1 : -1;
                
                const currentRot = propeller.getLocalRotation();
                const rotAngle = rotSpeed * direction;
                const rotDelta = new pc.Quat().setFromAxisAngle(new pc.Vec3(0, 1, 0), rotAngle);
                const newRot = rotDelta.mul(currentRot);
                propeller.setLocalRotation(newRot);
            }
        }
    };
    
    // Check if the drone is currently landed
    DroneController.prototype.isLanded = function() {
        // Make sure velocity exists first
        if (!this.velocity) {
            this.velocity = new pc.Vec3(0, 0, 0);
        }
        
        // Consider landed if very close to ground and not moving vertically
        const altitude = this.entity.getPosition().y;
        return altitude < 1.2 && Math.abs(this.velocity.y) < 0.1;
    };
    
    return DroneController;
} 