import os,pathlib,socket,subprocess,time,urllib.request

def free_port():
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));return sock.getsockname()[1]
def run(root,env,admin_sql,bao_request,root_token,messenger=False,continuity=False,recovery=False,messenger_ui=False,messenger_ui_only=False,groups=False,groups_only=False,forum=False,enrollment=False):
    api_port=free_port();frontend_port=free_port();child=env.copy()
    child.update(MESSENGER_ENABLED='true' if messenger else 'false',IDENTITY_ENABLED='true',DB_USERNAME=env['MIGRATION_DB_USERNAME'],DB_PASSWORD=env['MIGRATION_DB_PASSWORD'],SERVER_PORT=str(api_port),FRONTEND_ORIGINS=f'http://localhost:{frontend_port}',M1_API=f'http://localhost:{api_port}',M1_FRONTEND=f'http://localhost:{frontend_port}',M1_ARTIFACT_DIR=str(pathlib.Path(env['OPENBAO_TOKEN_FILE']).parent))
    email='browser-'+env['M1_DB_NAME'].removeprefix('polylink_m1_')+'@polytechnic.am';child['M1_BROWSER_EMAIL']=email
    maven=[str(root/'backend/mvnw'),'-B','-q','-f',str(root/'backend/pom.xml')]
    # Synthetic eligibility records exist only inside this disposable acceptance database.
    records=[(email,'Browser','Fixture','graduate')]
    records += [(email.replace('browser-',f'enrollment-ui-{i}-'),'Enrollment',role,role) for i,role in [(1,'graduate'),(2,'lecturer')]]
    records += [(email.replace('browser-',f'm2-{i}-'),'M2','Fixture','graduate') for i in range(1,4)]
    records += [(email.replace('browser-',f'm5-{i}-'),'M5',f'User{i}','graduate') for i in range(1,4)]
    records += [(email.replace('browser-',f'm6-{i}-'),'M6',f'User{i}','graduate') for i in range(1,5)]
    records += [(email.replace('browser-',f'forum-{i}-'),'Forum',role,role) for i,role in [(1,'graduate'),(2,'lecturer')]]
    sql=f"USE [{env['M1_DB_NAME']}]; "
    sql+="IF NOT EXISTS(SELECT 1 FROM dbo.Specializations) INSERT dbo.Specializations(Name) VALUES (N'Browser fixture'); IF NOT EXISTS(SELECT 1 FROM dbo.Departments) INSERT dbo.Departments(Name) VALUES (N'Browser fixture'); IF NOT EXISTS(SELECT 1 FROM dbo.Professions) INSERT dbo.Professions(Name) VALUES (N'Browser fixture'); "
    for address,first,last,role in records:
        if role=='graduate':
            sql+=f"INSERT dbo.AlumniRegistry(FirstName,LastName,DiplomaNumber,StudyStartDate,StudyEndDate,SpecializationId) SELECT N'{first}',N'{last}',N'{address}','2021-09-01','2025-06-01',(SELECT TOP(1) SpecializationId FROM dbo.Specializations ORDER BY SpecializationId); "
        else:
            sql+=f"INSERT dbo.LecturerRegistry(Email,DepartmentId,FirstName,LastName) SELECT N'{address}',(SELECT TOP(1) DepartmentId FROM dbo.Departments ORDER BY DepartmentId),N'{first}',N'{last}'; "
    admin_sql(sql)
    # The HTTP and browser suites share one disposable DB and loopback IP.
    # Start browser scenarios with an independent rate-limit budget.
    admin_sql(f"USE [{env['M1_DB_NAME']}]; DELETE FROM auth.RateLimits;")
    def messenger_cases():
        admin_sql(f"USE [{env['M1_DB_NAME']}]; DELETE auth.RateLimits;")
        subprocess.run(['node',str(root/'tools/m5/browser.mjs'),'setup'],cwd=root,env=child,check=True)
        admin_sql(f"USE [{env['M1_DB_NAME']}]; DECLARE @room uniqueidentifier=NEWID(); INSERT messaging.Rooms(RoomId,IsGroup,Closed,MembershipVersion,LastSequence,CreatedAt) VALUES (@room,1,0,1,0,SYSDATETIMEOFFSET()); INSERT messaging.Participants(RoomId,UserId,JoinedSequence,HistoryCutoff,LastReadSequence,Hidden,Muted) SELECT @room,UserId,1,0,0,0,0 FROM dbo.Users WHERE Email IN (N'{email.replace('browser-','m5-1-')}',N'{email.replace('browser-','m5-2-')}',N'{email.replace('browser-','m5-3-')}');")
        for phase in ['ui','mock']:subprocess.run(['node',str(root/'tools/m5/browser.mjs'),phase],cwd=root,env=child,check=True)
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
            if enrollment:
                subprocess.run(['node',str(root/'tools/m1/enrollment-ui.mjs')],cwd=root,env=child,check=True)
                subprocess.run(['node',str(root/'tools/m1/enrollment-mock.mjs')],cwd=root,env=child,check=True)
                return
            if forum:
                subprocess.run(['node',str(root/'tools/m1/forum-live.mjs')],cwd=root,env=child,check=True)
                subprocess.run(['node',str(root/'tools/m1/forum-ui.mjs')],cwd=root,env=child,check=True)
                return
            if groups_only:
                subprocess.run(['node',str(root/'tools/m6/browser.mjs')],cwd=root,env=child,check=True);subprocess.run(['node',str(root/'tools/m6/mock.mjs')],cwd=root,env=child,check=True);return
            if messenger_ui_only:
                messenger_cases();return
            if messenger:
                subprocess.run(['node',str(root/'tools/m2/browser.mjs')],cwd=root,env=child,check=True)
            if recovery:
                admin_sql(f"USE [{env['M1_DB_NAME']}]; DECLARE @room uniqueidentifier=NEWID(); INSERT messaging.Rooms(RoomId,IsGroup,Closed,MembershipVersion,LastSequence,CreatedAt) VALUES (@room,1,0,1,0,SYSDATETIMEOFFSET()); INSERT messaging.Participants(RoomId,UserId,JoinedSequence,HistoryCutoff,LastReadSequence,Hidden,Muted) SELECT @room,UserId,1,0,0,0,0 FROM dbo.Users WHERE Email IN (N'{email.replace('browser-','m2-1-')}',N'{email.replace('browser-','m2-2-')}',N'{email.replace('browser-','m2-3-')}');")
            subprocess.run(['node',str(root/'tools/m1/browser.mjs'),'setup'],cwd=root,env=child,check=True)
            admin_sql(f"USE [{env['M1_DB_NAME']}]; UPDATE auth.AccountSecurity SET EmailFactorEnabled=1 WHERE UserId=(SELECT UserId FROM dbo.Users WHERE Email=N'{email}');")
            admin=__import__('json').loads(pathlib.Path(env['M1_BAO_ADMIN_FILE']).read_text())
            bao_request('sys/seal',{},root_token)
            try:
                subprocess.run(['node',str(root/'tools/m1/browser.mjs'),'resume'],cwd=root,env=child,check=True)
                subprocess.run(['node',str(root/'tools/m1/browser.mjs'),'factor'],cwd=root,env=child,check=True)
                if continuity:
                    for phase in ['continuity','restart']:
                        subprocess.run(['node',str(root/'tools/m3/browser.mjs'),phase],cwd=root,env=child,check=True)
                    m3email=email.replace('browser-','m2-1-')
                    admin_sql(f"USE [{env['M1_DB_NAME']}]; UPDATE auth.AccountSecurity SET EmailFactorEnabled=1 WHERE UserId=(SELECT UserId FROM dbo.Users WHERE Email=N'{m3email}');")
                    subprocess.run(['node',str(root/'tools/m3/browser.mjs'),'password'],cwd=root,env=child,check=True)
                if recovery:subprocess.run(['node',str(root/'tools/m4/browser.mjs'),'local'],cwd=root,env=child,check=True)
            finally:bao_request('sys/unseal',{'key':admin['keys_base64'][0]})
            if recovery:
                for phase in ['service','peer']:subprocess.run(['node',str(root/'tools/m4/browser.mjs'),phase],cwd=root,env=child,check=True)
            if messenger_ui:messenger_cases()
            if groups:
                admin_sql(f"USE [{env['M1_DB_NAME']}]; DELETE auth.RateLimits;")
                subprocess.run(['node',str(root/'tools/m6/browser.mjs')],cwd=root,env=child,check=True)
                subprocess.run(['node',str(root/'tools/m6/mock.mjs')],cwd=root,env=child,check=True)
                admin_sql(f"USE [{env['M1_DB_NAME']}]; DELETE auth.RateLimits;")
                subprocess.run(['node',str(root/'tools/m1/forum-live.mjs')],cwd=root,env=child,check=True)
                subprocess.run(['node',str(root/'tools/m1/forum-ui.mjs')],cwd=root,env=child,check=True)
                admin_sql(f"USE [{env['M1_DB_NAME']}]; DELETE auth.RateLimits;")
                subprocess.run(['node',str(root/'tools/m1/enrollment-ui.mjs')],cwd=root,env=child,check=True)
                subprocess.run(['node',str(root/'tools/m1/enrollment-mock.mjs')],cwd=root,env=child,check=True)
        finally:
            backend.terminate();static.terminate()
            try:backend.wait(timeout=15)
            except subprocess.TimeoutExpired:backend.kill();backend.wait()
            try:static.wait(timeout=5)
            except subprocess.TimeoutExpired:static.kill();static.wait()
