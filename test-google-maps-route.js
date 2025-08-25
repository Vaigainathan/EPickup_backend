// Test Google Maps Route Loading
const googleMapsRoutes = require('./src/routes/googleMaps');

console.log('🔍 Testing Google Maps Route Loading...');

// Check if the router is properly exported
if (googleMapsRoutes) {
  console.log('✅ Google Maps routes module loaded successfully');
  
  // Check if it's an Express router
  if (googleMapsRoutes.stack) {
    console.log('✅ Routes registered:', googleMapsRoutes.stack.length);
    
    // List all registered routes
    googleMapsRoutes.stack.forEach((layer, index) => {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods);
        console.log(`  ${index + 1}. ${methods.join(',').toUpperCase()} ${layer.route.path}`);
      }
    });
  } else {
    console.log('❌ Routes not properly registered');
  }
} else {
  console.log('❌ Google Maps routes module failed to load');
}
