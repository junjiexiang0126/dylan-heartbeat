'use strict';
const path=require('node:path');

// Keep previews portable and separate Chromium/WebKit output. Without an
// override, Playwright owns the per-test artifact directory and its cleanup.
function screenshotPath(testInfo,name){
 return process.env.SCREENSHOT_DIR
  ?path.resolve(process.env.SCREENSHOT_DIR,testInfo.project.name,name)
  :testInfo.outputPath(name);
}
module.exports={screenshotPath};
