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
    
    // Initialize the controller
    DroneController.prototype.initialize = function() {
        // State management
        this.state = 'grounded'; // Start on the ground
        
        // Physics state
        this.velocity = new pc.Vec3(0, 0, 0);
        
        // Altitude control
        this.targetAltitude = this.groundHeight; // Start at ground level
        this.lastHeightError = 0; // For derivative control
        
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
        // Check for state transitions
        if (this.state === 'grounded') {
            // Can only take off if throttle is above threshold
            if (this.throttle > this.liftoffThreshold) {
                this.state = 'flying';
                console.log("Drone taking off");
                
                // Set initial target altitude slightly above ground
                this.targetAltitude = this.groundHeight + 1.0;
            }
        } else if (this.state === 'flying') {
            // Return to ground if too low and trying to descend
            const height = this.entity.getPosition().y;
            if (height <= this.groundHeight + 0.1 && this.verticalInput < 0) {
                this.state = 'grounded';
                this.velocity.set(0, 0, 0); // Stop all movement
                console.log("Drone landed");
                
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