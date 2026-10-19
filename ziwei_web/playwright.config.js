'use strict';
const {defineConfig,devices}=require('@playwright/test');
module.exports=defineConfig({
 testDir:'./e2e',
 projects:[{name:'chromium',use:{browserName:'chromium'}},{name:'webkit',use:{...devices['iPhone 13'],browserName:'webkit'}}],
 fullyParallel:false,workers:1,reporter:'list',
 use:{baseURL:'https://localhost:3187',ignoreHTTPSErrors:true,headless:true,serviceWorkers:'block',trace:'retain-on-failure',screenshot:'only-on-failure'},
});
