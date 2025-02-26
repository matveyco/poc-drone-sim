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

// Position the camera initially
camera.setPosition(0, 10, 15);
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

// Create drone entity
const drone = new pc.Entity('drone');
app.root.addChild(drone);

// Create the drone controller script
const DroneController = createDroneController(app);

// Create the camera follow script
const CameraFollow = createCameraFollow(app);

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
        
        // Set up camera to follow drone
        camera.script.create('cameraFollow', {
            target: drone,
            distance: 10,  // Distance behind the drone
            height: 5      // Height above the drone
        });
        
        console.log('Drone model loaded successfully');
    } else {
        console.error('Error loading drone model:', err);
    }
});

// Start the application update loop
app.start(); 