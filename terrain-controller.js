function createTerrainController(app) {
    var TerrainController = pc.createScript('terrainController');
    
    // Initialize properties
    TerrainController.attributes.add('size', { type: 'number', default: 100 });
    TerrainController.attributes.add('height', { type: 'number', default: 10 });
    TerrainController.attributes.add('segments', { type: 'number', default: 50 });
    TerrainController.attributes.add('startPosition', { type: 'vec3', default: [0, 0, 0] });
    TerrainController.attributes.add('endPosition', { type: 'vec3', default: [30, 0, 30] });
    
    // Called once after all resources are loaded
    TerrainController.prototype.initialize = function() {
        this.createTerrain();
        this.createStartMarker();
        this.createEndMarker();
        this.createUI();
        
        // Make positions available to other scripts
        app.globals = app.globals || {};
        app.globals.startPosition = this.startPosition;
        app.globals.endPosition = this.endPosition;
        app.globals.missionComplete = false;
    };
    
    // Create the terrain and boundaries
    TerrainController.prototype.createTerrain = function() {
        // Create a flat central area for the drone to take off/land
        const terrain = new pc.Entity('terrain');
        terrain.addComponent('render', {
            type: 'box',
            material: new pc.StandardMaterial()
        });
        terrain.render.material.diffuse.set(0.4, 0.6, 0.3);
        terrain.render.material.update();
        terrain.setLocalScale(this.size, 1, this.size);
        terrain.setPosition(0, -0.5, 0);
        app.root.addChild(terrain);
        
        // Create terrain boundaries/walls
        this.createBoundaries();
    };
    
    // Create boundaries/edges for the terrain
    TerrainController.prototype.createBoundaries = function() {
        const wallHeight = 15;
        const wallThickness = 2;
        const halfSize = this.size / 2;
        
        // Create four walls
        const walls = [
            { name: 'northWall', pos: [0, wallHeight/2, -halfSize], scale: [this.size, wallHeight, wallThickness] },
            { name: 'southWall', pos: [0, wallHeight/2, halfSize], scale: [this.size, wallHeight, wallThickness] },
            { name: 'eastWall', pos: [halfSize, wallHeight/2, 0], scale: [wallThickness, wallHeight, this.size] },
            { name: 'westWall', pos: [-halfSize, wallHeight/2, 0], scale: [wallThickness, wallHeight, this.size] }
        ];
        
        walls.forEach(wall => {
            const entity = new pc.Entity(wall.name);
            entity.addComponent('render', {
                type: 'box',
                material: new pc.StandardMaterial()
            });
            entity.render.material.diffuse = new pc.Color(0.7, 0.5, 0.3);
            entity.render.material.update();
            entity.setLocalPosition(wall.pos[0], wall.pos[1], wall.pos[2]);
            entity.setLocalScale(wall.scale[0], wall.scale[1], wall.scale[2]);
            app.root.addChild(entity);
        });
    };
    
    // Create a visual marker for the start position
    TerrainController.prototype.createStartMarker = function() {
        const startMarker = new pc.Entity('startMarker');
        startMarker.addComponent('render', {
            type: 'cylinder',
            material: new pc.StandardMaterial()
        });
        
        // Green color for start
        startMarker.render.material.diffuse = new pc.Color(0, 1, 0);
        startMarker.render.material.emissive = new pc.Color(0, 0.5, 0);
        startMarker.render.material.update();
        
        // Position and scale
        startMarker.setLocalScale(5, 0.2, 5);
        startMarker.setPosition(this.startPosition.x, 0.1, this.startPosition.z);
        
        // Add a label
        this.createLabel(startMarker, "START", 0, 1, 0);
        
        app.root.addChild(startMarker);
    };
    
    // Create a visual marker for the end position
    TerrainController.prototype.createEndMarker = function() {
        const endMarker = new pc.Entity('endMarker');
        endMarker.addComponent('render', {
            type: 'cylinder',
            material: new pc.StandardMaterial()
        });
        
        // Red color for end
        endMarker.render.material.diffuse = new pc.Color(1, 0, 0);
        endMarker.render.material.emissive = new pc.Color(0.5, 0, 0);
        endMarker.render.material.update();
        
        // Position and scale
        endMarker.setLocalScale(5, 0.2, 5);
        endMarker.setPosition(this.endPosition.x, 0.1, this.endPosition.z);
        
        // Add a label
        this.createLabel(endMarker, "FINISH", 1, 0, 0);
        
        app.root.addChild(endMarker);
        
        // Add collision detection for the end marker
        endMarker.addComponent('collision', {
            type: 'cylinder',
            radius: 2.5,
            height: 1
        });
        
        endMarker.addComponent('rigidbody', {
            type: 'static',
            restitution: 0
        });
    };
    
    // Helper function to create text labels
    TerrainController.prototype.createLabel = function(parent, text, r, g, b) {
        const label = new pc.Entity('label');
        label.addComponent('element', {
            type: 'text',
            text: text,
            fontAsset: null, // Will use default font
            fontSize: 32,
            color: new pc.Color(r, g, b),
            width: 128,
            height: 32,
            anchor: new pc.Vec4(0.5, 0.5, 0.5, 0.5)
        });
        
        label.setLocalPosition(0, 1, 0);
        label.setLocalEulerAngles(90, 0, 0);
        parent.addChild(label);
    };
    
    // Create UI for mission status
    TerrainController.prototype.createUI = function() {
        // Create a screen
        this.screen = new pc.Entity('MissionScreen');
        this.screen.addComponent('screen', { resolution: new pc.Vec2(1920, 1080), screenSpace: true });
        app.root.addChild(this.screen);
        
        // Create mission complete text (hidden by default)
        this.missionCompleteUI = new pc.Entity('MissionComplete');
        this.missionCompleteUI.addComponent('element', {
            type: 'text',
            text: 'MISSION COMPLETE!',
            fontAsset: null,
            fontSize: 64,
            color: new pc.Color(0, 1, 0),
            width: 800,
            height: 100,
            anchor: new pc.Vec4(0.5, 0.5, 0.5, 0.5),
            pivot: new pc.Vec2(0.5, 0.5)
        });
        this.missionCompleteUI.setLocalPosition(0, 100, 0);
        this.missionCompleteUI.enabled = false;
        this.screen.addChild(this.missionCompleteUI);
    };
    
    // Method to check if drone is at the end position and landed
    TerrainController.prototype.checkMissionComplete = function(droneEntity) {
        if (app.globals.missionComplete) return; // Already completed
        
        const dronePos = droneEntity.getPosition();
        const endPos = this.endPosition;
        
        // Check if drone is close to end position and has landed
        const distance = Math.sqrt(
            Math.pow(dronePos.x - endPos.x, 2) + 
            Math.pow(dronePos.z - endPos.z, 2)
        );
        
        const isLanded = droneEntity.script && 
                         droneEntity.script.droneController && 
                         droneEntity.script.droneController.isLanded();
        
        if (distance < 2.5 && isLanded) {
            this.completeMission();
        }
    };
    
    // Handle mission completion
    TerrainController.prototype.completeMission = function() {
        app.globals.missionComplete = true;
        this.missionCompleteUI.enabled = true;
        
        // Instead of using tween, we'll manually handle pulsing in the update method
        this.missionCompleteUI.pulseTime = 0;
        this.isPulsing = true;
        
        console.log("Mission complete!");
    };
    
    // Update called every frame
    TerrainController.prototype.update = function(dt) {
        // Find drone if it exists
        const drone = app.root.findByName('Drone');
        if (drone) {
            this.checkMissionComplete(drone);
        }
        
        // Handle mission complete text pulsing
        if (this.isPulsing && this.missionCompleteUI && this.missionCompleteUI.enabled) {
            this.missionCompleteUI.pulseTime = (this.missionCompleteUI.pulseTime || 0) + dt;
            // Simple sine wave pulsing for opacity
            const opacity = 0.5 + 0.5 * Math.sin(this.missionCompleteUI.pulseTime * 3);
            if (this.missionCompleteUI.element) {
                this.missionCompleteUI.element.opacity = opacity;
            }
        }
    };
    
    return TerrainController;
} 