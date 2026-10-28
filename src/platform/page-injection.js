import source from '../../.generated/page-world.txt';
export function captureBootstrap(profile,channel) {return source+'\nwindow.__multicaPageWorld.capture('+JSON.stringify(profile)+','+JSON.stringify(channel)+');';}
export function routeBootstrap(channel) {return source+'\nwindow.__multicaPageWorld.routes('+JSON.stringify(channel)+');';}
