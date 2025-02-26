// Camera follow script
function createCameraFollow(app) {
    const CameraFollow = pc.createScript('cameraFollow');
    
    // Script attributes - simplified for performance
    CameraFollow.attributes.add('target', { type: 'entity' });
    CameraFollow.attributes.add('distance', { type: 'number', default: 10 });
    CameraFollow.attributes.add('height', { type: 'number', default: 5 });
    CameraFollow.attributes.add('smoothFactor', { type: 'number', default: 0.5 }); // Faster camera
    CameraFollow.attributes.add('lookHeightOffset', { type: 'number', default: 2 });
    CameraFollow.attributes.add('viewMode', {
        type: 'number', 
        default: 0,
        enum: [
            { 'Follow': 0 },
            { 'Chase': 1 },
            { 'First Person': 2 }
        ]
    });
    
    // Initialize the script
    CameraFollow.prototype.initialize = function() {
        // Pre-allocate vector objects to avoid garbage collection
        this.targetPosition = new pc.Vec3();
        this.targetLookPosition = new pc.Vec3();
        this.currentRotation = new pc.Quat();
        
        // Reusable vector objects
        this._back = new pc.Vec3();
        this._up = new pc.Vec3();
        this._forward = new pc.Vec3();
        this._desiredPosition = new pc.Vec3();
        this._lookAtPos = new pc.Vec3();
        this._worldBack = new pc.Vec3();
        this._worldForward = new pc.Vec3();
        this._firstPersonOffset = new pc.Vec3();
        this._targetEuler = new pc.Vec3();
        
        // Store a reference to the shared keyboard
        this.keyboard = new pc.Keyboard(document.body);
        
        // Manual keyboard event handler
        const self = this;
        window.addEventListener('keydown', function(e) {
            // Switch camera modes with number keys (1, 2, 3)
            if (e.key >= '1' && e.key <= '3') {
                self.viewMode = parseInt(e.key) - 1;
                console.log("Camera mode switched to: " + self.viewMode);
            }
        });
    };
    
    // Update the camera position and rotation every frame
    CameraFollow.prototype.update = function(dt) {
        if (!this.target) return;
        
        // Only do expensive calculations at 60 fps max
        const fixedDt = Math.min(dt, 1/60);
        
        const targetPos = this.target.getPosition();
        const targetRot = this.target.getRotation();
        
        switch(this.viewMode) {
            case 0: // Follow mode
                this.updateFollowCamera(targetPos, targetRot, fixedDt);
                break;
            case 1: // Chase mode
                this.updateChaseCamera(targetPos, targetRot, fixedDt);
                break;
            case 2: // First person mode
                this.updateFirstPersonCamera(targetPos, targetRot);
                break;
        }
    };
    
    CameraFollow.prototype.updateFollowCamera = function(targetPos, targetRot, dt) {
        // Calculate desired camera position - behind and above target
        this._back.set(0, 0, this.distance);
        this._up.set(0, this.height, 0);
        
        // Get world space position for camera (behind target)
        this._desiredPosition.copy(targetPos).add(this._up);
        
        targetRot.transformVector(this._back, this._worldBack);
        this._desiredPosition.add(this._worldBack);
        
        // Smooth camera movement - faster response
        this.targetPosition.lerp(this.targetPosition, this._desiredPosition, this.smoothFactor);
        this.entity.setPosition(this.targetPosition);
        
        // Look at target with slight height offset
        this._lookAtPos.set(targetPos.x, targetPos.y + this.lookHeightOffset, targetPos.z);
        this.entity.lookAt(this._lookAtPos);
    };
    
    CameraFollow.prototype.updateChaseCamera = function(targetPos, targetRot, dt) {
        // Get target's forward direction
        this._forward.set(0, 0, -1);
        targetRot.transformVector(this._forward, this._worldForward);
        
        // Position camera behind target in chase position
        this._worldForward.scale(-this.distance);
        this._up.set(0, this.height, 0);
        
        this._desiredPosition.copy(targetPos).add(this._worldForward).add(this._up);
        
        // Smooth camera movement - faster response
        this.targetPosition.lerp(this.targetPosition, this._desiredPosition, this.smoothFactor);
        this.entity.setPosition(this.targetPosition);
        
        // Look at target with slight height offset
        this._lookAtPos.set(targetPos.x, targetPos.y + this.lookHeightOffset, targetPos.z);
        this.entity.lookAt(this._lookAtPos);
    };
    
    CameraFollow.prototype.updateFirstPersonCamera = function(targetPos, targetRot) {
        // First-person position (slightly above the drone)
        this._firstPersonOffset.set(0, 0.8, 0);
        targetRot.transformVector(this._firstPersonOffset, this._firstPersonOffset);
        
        this._desiredPosition.copy(targetPos).add(this._firstPersonOffset);
        this.entity.setPosition(this._desiredPosition);
        
        // Copy rotation of target (except roll)
        targetRot.getEulerAngles(this._targetEuler);
        
        // Keep only pitch and yaw for first-person view
        this.entity.setEulerAngles(this._targetEuler.x, this._targetEuler.y, 0);
    };
    
    return CameraFollow;
} 