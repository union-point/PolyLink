#!/usr/bin/env python3
"""Real SQL/OpenBao TLS/SMTP acceptance in uniquely named disposable resources."""
import argparse, base64, json, os, pathlib, secrets, socket, ssl, subprocess, tempfile, time, urllib.request, uuid, shutil

ROOT=pathlib.Path(__file__).resolve().parents[2]
def run(args,**kw): return subprocess.run(args,check=True,**kw)
def free_port():
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));return sock.getsockname()[1]
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--forum',action='store_true');parser.add_argument('--browser',action='store_true');parser.add_argument('--messenger',action='store_true');parser.add_argument('--continuity',action='store_true');parser.add_argument('--recovery',action='store_true');parser.add_argument('--messenger-ui',action='store_true');parser.add_argument('--messenger-ui-only',action='store_true');parser.add_argument('--groups',action='store_true');parser.add_argument('--groups-only',action='store_true');args=parser.parse_args();args.groups=args.groups or args.groups_only;args.messenger_ui=args.messenger_ui or (args.groups and not args.groups_only);args.messenger_ui=args.messenger_ui or args.messenger_ui_only;args.recovery=args.recovery or (args.messenger_ui and not args.messenger_ui_only);args.continuity=args.continuity or args.recovery;args.messenger=args.messenger or args.continuity or args.messenger_ui or args.groups
    password=os.environ.get('DB_TEST_ADMIN_PASSWORD')
    if not password:raise SystemExit('Set DB_TEST_ADMIN_PASSWORD for an isolated SQL Server administrator.')
    name='polylink_m1_'+uuid.uuid4().hex;bao=name+'-bao';mail=name+'-mail';database_created=False
    with tempfile.TemporaryDirectory(prefix='polylink-m1-') as directory:
        temp=pathlib.Path(directory);port=free_port();smtp=free_port();mailapi=free_port()
        cert=temp/'server.crt';key=temp/'server.key';config=temp/'openbao.hcl';data=temp/'data';data.mkdir()
        run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-keyout',str(key),'-out',str(cert)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        config.write_text('disable_mlock=true\napi_addr="https://localhost:8200"\ncluster_addr="https://127.0.0.1:8201"\nstorage "raft" { path="/fixture/data" node_id="test" }\nlistener "tcp" { address="0.0.0.0:8200" tls_cert_file="/fixture/server.crt" tls_key_file="/fixture/server.key" }\n')
        ctx=ssl.create_default_context(cafile=str(cert));base=f'https://localhost:{port}'
        def request(path,body=None,token=None,method=None):
            headers={'Content-Type':'application/json'}
            if token:headers['X-Vault-Token']=token
            req=urllib.request.Request(base+'/v1/'+path,data=None if body is None else json.dumps(body).encode(),headers=headers,method=method)
            with urllib.request.urlopen(req,context=ctx,timeout=10) as response:
                raw=response.read();return json.loads(raw) if raw else None
        env=os.environ.copy();env.update(FORUM_ENABLED='true',DB_NAME=name,M1_DB_NAME=name,DB_PASSWORD=password,MIGRATION_DB_PASSWORD=password,MIGRATION_DB_USERNAME=env.get('DB_TEST_ADMIN_USERNAME','sa'),DB_TRUST_SERVER_CERTIFICATE='true',AUTH_HMAC_KEY=secrets.token_urlsafe(32),AUTH_REPLAY_KEY=secrets.token_urlsafe(32),OPENBAO_URL=base,OPENBAO_TOKEN_FILE=str(temp/'backend.token'),SMTP_HOST='localhost',SMTP_PORT=str(smtp),M1_MAILPIT_URL=f'http://localhost:{mailapi}')
        java_home=pathlib.Path(env['JAVA_HOME']) if env.get('JAVA_HOME') else pathlib.Path(shutil.which('java')).resolve().parent.parent
        trust=temp/'trust.jks';shutil.copyfile(java_home/'lib/security/cacerts',trust);keytool=java_home/'bin/keytool'
        run([str(keytool),'-importcert','-noprompt','-alias','openbao-test','-file',str(cert),'-keystore',str(trust),'-storepass','changeit'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        env['JAVA_TOOL_OPTIONS']=(env.get('JAVA_TOOL_OPTIONS','')+f' -Djavax.net.ssl.trustStore={trust} -Djavax.net.ssl.trustStorePassword=changeit').strip()
        try:
            run(['docker','run','-d','--name',bao,'--user',f'{os.getuid()}:{os.getgid()}','--entrypoint','bao','-p',f'127.0.0.1:{port}:8200','-v',f'{temp}:/fixture:Z','openbao/openbao:2.7.1','server','-config=/fixture/openbao.hcl'],stdout=subprocess.DEVNULL)
            for attempt in range(100):
                try:
                    request('sys/init');break
                except Exception:
                    if attempt==99:raise
                    time.sleep(.1)
            admin=request('sys/init',{'secret_shares':1,'secret_threshold':1});request('sys/unseal',{'key':admin['keys_base64'][0]})
            root=admin['root_token'];request('sys/mounts/transit',{'type':'transit'},root)
            request('transit/keys/polylink-vault',{'type':'aes256-gcm96','derived':True,'exportable':False,'allow_plaintext_backup':False},root)
            request('sys/policies/acl/polylink-backend',{'policy':(ROOT/'infra/openbao/backend-policy.hcl').read_text()},root,method='PUT')
            credential=request('auth/token/create',{'policies':['polylink-backend'],'no_default_policy':True,'ttl':'1h','renewable':True},root)['auth']['client_token']
            token=temp/'backend.token';token.write_text(credential);token.chmod(0o600)
            adminfile=temp/'operator-test-only.json';adminfile.write_text(json.dumps(admin));adminfile.chmod(0o600);env['M1_BAO_ADMIN_FILE']=str(adminfile)
            run(['docker','run','-d','--name',mail,'-p',f'127.0.0.1:{smtp}:1025','-p',f'127.0.0.1:{mailapi}:8025','axllent/mailpit:v1.31.6'],stdout=subprocess.DEVNULL)
            # Use the project's JDBC dependencies to create only the uniquely named target.
            helper=ROOT/'backend/target/M1Admin.java';helper.parent.mkdir(parents=True,exist_ok=True)
            helper.write_text('import java.sql.*; public class M1Admin { public static void main(String[] args)throws Exception { var p=new java.util.Properties();p.setProperty("user",System.getenv("MIGRATION_DB_USERNAME"));p.setProperty("password",System.getenv("MIGRATION_DB_PASSWORD"));p.setProperty("databaseName","master");p.setProperty("encrypt","true");p.setProperty("trustServerCertificate","true");p.setProperty("loginTimeout","10");try(var c=DriverManager.getConnection("jdbc:sqlserver://"+System.getenv().getOrDefault("DB_HOST","localhost")+":"+System.getenv().getOrDefault("DB_PORT","1433"),p)){c.createStatement().execute(System.getenv("M1_ADMIN_SQL"));}}}')
            maven=[str(ROOT/'backend/mvnw'),'-B','-q','-f',str(ROOT/'backend/pom.xml')]
            run(maven+['-U','test-compile','dependency:build-classpath','-Dmdep.outputFile=target/m1-classpath.txt'],cwd=ROOT,env=env)
            cp=(ROOT/'backend/target/m1-classpath.txt').read_text().strip()
            java=pathlib.Path(env.get('JAVA_HOME','/usr'))/'bin/java'
            def admin_sql(sql):
                child=env.copy();child['M1_ADMIN_SQL']=sql
                run([str(java),'--class-path',cp,str(helper)],cwd=ROOT,env=child,stdout=subprocess.DEVNULL)
            admin_sql('CREATE DATABASE ['+name+'] COLLATE SQL_Latin1_General_CP1_CI_AS');database_created=True
            run(maven+['exec:java','-Dexec.mainClass=am.polylink.database.SchemaCommand','-Dexec.args=fresh'],cwd=ROOT,env=env)
            run(maven+['-Pdatabase-tests','verify']+(['-Dit.test=ForumIT'] if args.forum else ['-Dit.test=GroupIT,MessengerStateIT'] if args.groups_only else ['-Dit.test=MessengerStateIT'] if args.messenger_ui_only else []),cwd=ROOT,env=env)
            if args.browser or args.messenger or args.forum:
                import browser_check
                browser_check.run(ROOT,env,admin_sql,request,root,messenger=args.messenger,continuity=args.continuity,recovery=args.recovery,messenger_ui=args.messenger_ui,messenger_ui_only=args.messenger_ui_only,groups=args.groups,groups_only=args.groups_only,forum=args.forum)
            print(('Forum' if args.forum else 'M6 focused' if args.groups_only else 'M1–M6' if args.groups else 'M5 focused' if args.messenger_ui_only else 'M1–M5' if args.messenger_ui else 'M1/M2/M3/M4' if args.recovery else 'M1/M2/M3' if args.continuity else 'M1/M2' if args.messenger else 'M1')+' SQL, TLS Transit, SMTP and HTTP acceptance passed.')
        finally:
            if database_created:admin_sql('ALTER DATABASE ['+name+'] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ['+name+']')
            subprocess.run(['docker','rm','-f',bao,mail],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
if __name__=='__main__':main()
