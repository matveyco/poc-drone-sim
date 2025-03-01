// Add these lines to your DroneController.prototype.initialize function:
// (around line 51 after initializing velocity)

// External control inputs
this._externalInputs = {
    upDown: 0,      // Vertical control (Space/Shift)
    forwardBack: 0, // Forward/Back control (W/S)
    leftRight: 0,   // Left/Right control (A/D)
    yaw: 0,         // Yaw control (Q/E)
    lastControl: 0  // Timestamp of last external control
}; 