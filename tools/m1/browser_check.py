import os,pathlib,socket,subprocess,time,urllib.request

def free_port():
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));return sock.getsockname()[1]
def run(root,env,admin_sql,bao_request,root_token,messenger=False):
    api_port=free_port();frontend_port=free_port();child=env.copy()
    child.update(MESSENGER_ENABLED='true' if messenger else 'false',IDENTITY_ENABLED='true',DB_USERNAME=env['MIGRATION_DB_USERNAME'],DB_PASSWORD=env['MIGRATION_DB_PASSWORD'],SERVER_PORT=str(api_port),FRONTEND_ORIGINS=f'http://localhost:{frontend_port}',M1_API=f'http://localhost:{api_port}',M1_FRONTEND=f'http://localhost:{frontend_port}',M1_ARTIFACT_DIR=str(pathlib.Path(env['OPENBAO_TOKEN_FILE']).parent))
    email='browser-'+env['M1_DB_NAME'].removeprefix('polylink_m1_')+'@example.invalid';child['M1_BROWSER_EMAIL']=email
    maven=[str(root/'backend/mvnw'),'-B','-q','-f',str(root/'backend/pom.xml')]
    subprocess.run(maven+['exec:java','-Dexec.mainClass=am.polylink.auth.AdmissionCommand',f'-Dexec.args=invite {email} graduate'],env=env,cwd=root,check=True)
    if messenger:
        for index in range(1,4):
            recipient=email.replace('browser-',f'm2-{index}-')
            subprocess.run(maven+['exec:java','-Dexec.mainClass=am.polylink.auth.AdmissionCommand',f'-Dexec.args=invite {recipient} graduate'],env=env,cwd=root,check=True)
    # The HTTP and browser suites share one disposable DB and loopback IP.
    # Start browser scenarios with an independent rate-limit budget.
    admin_sql(f"USE [{env['M1_DB_NAME']}]; DELETE FROM auth.RateLimits;")
    logpath=pathlib.Path(child['M1_ARTIFACT_DIR'])/'backend.log'
    with open(logpath,'w') as log:
        backend=subprocess.Popen([str(pathlib.Path(env['JAVA_HOME'])/'bin/java'),'-jar',str(root/'backend/target/polylink-backend-0.0.1-SNAPSHOT.jar')],env=child,cwd=root,stdout=log,stderr=subprocess.STDOUT)
        static=subprocess.Popen(['python3',str(root/'server.py'),'--port',str(frontend_port)],cwd=root,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            for i in range(150):
                try:
                    urllib.request.urlopen(child['M1_API']+'/actuator/health',timeout=2);break
                except Exception:
                    if backend.poll() is not None:raise RuntimeError('M1 browser backend failed: '+logpath.read_text()[-4000:])
                    if i==149:raise RuntimeError('M1 browser backend readiness timeout')
                    time.sleep(.1)
            if messenger:
                subprocess.run(['node',str(root/'tools/m2/browser.mjs')],cwd=root,env=child,check=True)
            subprocess.run(['node',str(root/'tools/m1/browser.mjs'),'setup'],cwd=root,env=child,check=True)
            admin_sql(f"USE [{env['M1_DB_NAME']}]; UPDATE auth.AccountSecurity SET EmailFactorEnabled=1 WHERE UserId=(SELECT UserId FROM dbo.Users WHERE Email=N'{email}');")
            admin=__import__('json').loads(pathlib.Path(env['M1_BAO_ADMIN_FILE']).read_text())
            bao_request('sys/seal',{},root_token)
            try:
                subprocess.run(['node',str(root/'tools/m1/browser.mjs'),'resume'],cwd=root,env=child,check=True)
                subprocess.run(['node',str(root/'tools/m1/browser.mjs'),'factor'],cwd=root,env=child,check=True)
            finally:bao_request('sys/unseal',{'key':admin['keys_base64'][0]})
        finally:
            backend.terminate();static.terminate()
            try:backend.wait(timeout=15)
            except subprocess.TimeoutExpired:backend.kill();backend.wait()
            try:static.wait(timeout=5)
            except subprocess.TimeoutExpired:static.kill();static.wait()
