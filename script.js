// Initialize PlayCanvas application
const canvas = document.getElementById('application-canvas');
const app = new pc.Application(canvas);

// Fill the available space at full resolution
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);

// Ensure canvas is resized when window changes size
window.addEventListener('resize', () => app.resizeCanvas());

// Create camera entity
const camera = new pc.Entity('camera');
camera.addComponent('camera', {
    clearColor: new pc.Color(0.1, 0.2, 0.3)
});
camera.addComponent('script');
app.root.addChild(camera);

// Position the camera initially (this will be overridden by the controller)
// Just a default position in case the controller initialization is delayed
camera.setPosition(10, 10, 10);
camera.lookAt(0, 0, 0);

// Create directional light
const light = new pc.Entity('light');
light.addComponent('light', {
    type: 'directional',
    color: new pc.Color(1, 1, 1),
    castShadows: true,
    shadowBias: 0.2,
    shadowDistance: 50,
    normalOffsetBias: 0.05,
    intensity: 1
});
app.root.addChild(light);
light.setEulerAngles(45, 0, 0);

// Create ground plane
const ground = new pc.Entity('ground');
ground.addComponent('render', {
    type: 'box',
    material: new pc.StandardMaterial()
});
ground.render.material.diffuse.set(0.5, 0.5, 0.5);
ground.render.material.update();
ground.setLocalScale(50, 1, 50);
ground.setPosition(0, -0.5, 0);
app.root.addChild(ground);

// Create drone entity at the origin
const drone = new pc.Entity('Drone');
drone.setPosition(0, 1, 0); // Place drone 1 unit above the ground
app.root.addChild(drone);

// Create script definitions
const DroneController = createDroneController(app);
const CameraController = createCameraController(app);

// Start the application update loop
app.start();

// Load drone model
app.assets.loadFromUrl('models/drone.glb', 'container', function(err, asset) {
    if (!err) {
        // Add model component with the loaded asset
        const modelEntity = asset.resource.instantiateRenderEntity();
        
        // Scale down the model
        modelEntity.setLocalScale(0.14, 0.14, 0.14);
        
        drone.addChild(modelEntity);
        
        // Add drone controller script
        drone.addComponent('script');
        drone.script.create('droneController');
        
        // Add camera controller with explicit parameters
        camera.script.create('cameraController', {
            droneEntity: drone,
            distance: 15,
            height: 5
        });
        
        console.log('Drone and camera setup complete');
    } else {
        console.error('Error loading drone model:', err);
    }
}); 