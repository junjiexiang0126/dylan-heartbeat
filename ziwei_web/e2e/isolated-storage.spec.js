const {test,expect}=require('./helpers/isolated-app');
for(const index of [1,2])test('fresh server '+index,async({request})=>{
 expect((await request.get('/health')).status()).toBe(200);
 const login=await request.post('/api/login',{headers:{Origin:'https://localhost:3187'},data:{password:'isolated-e2e-password-123456'}});expect(login.status()).toBe(200);
 const s=await login.json();const home=await (await request.get('/api/home')).json();expect(home.user.nickname).not.toBe('fixture-changed');
 expect((await request.put('/api/home',{headers:{Origin:'https://localhost:3187','X-Ziwei-CSRF':s.csrf},data:{revision:home.revision,user:{...home.user,nickname:'fixture-changed'}}})).status()).toBe(200);
});
