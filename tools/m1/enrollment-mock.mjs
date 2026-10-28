import { chromium } from 'playwright';
import { isolateDecorativeAssets } from './browser-assets.mjs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:process.env.M1_CHROMIUM||undefined});
try{
  for(const role of ['graduate','lecturer']){
    const context=await browser.newContext();await isolateDecorativeAssets(context);
    await context.route('**/js/config.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace(/dataMode:\s*['"](?:mock|http)['"]/,'dataMode: "mock"').replace(/mockDatabase:\s*['"][^'"]+['"]/,`mockDatabase: "enrollment-${role}-${Date.now()}"`),contentType:'application/javascript'});});
    const page=await context.newPage();await page.goto(process.env.M1_FRONTEND+'/login.html');await page.locator('#login-form').waitFor();
    const result=await page.evaluate(async role=>{
      const {auth,search,settings,profiles}=await import('/js/services/index.js');
      const email=`new.${role}@polytechnic.am`,password='Demo enrollment!4',firstName='Demo',lastName=role==='graduate'?'Graduate':'Lecturer';
      const registered=await auth.register({email,password,firstName,lastName,role});
      const before=await auth.me();let denied;try{await search.people();}catch(error){denied=error.code;}
      const state=await auth.enrollment();const options=await auth.enrollmentOptions();
      const data={revision:state.revision,role,firstName:'Wrong',lastName,instituteId:options.institutes[0].id,...(role==='graduate'?{diplomaNumber:'DEMO-2025',specializationId:options.specializations[0].id,startYear:2021,endYear:2025}:{departmentId:options.departments[0].id,professionId:options.professions[0].id})};
      const wrong=await auth.saveEnrollment(data);let mismatch;try{await auth.submitEnrollment({revision:wrong.revision});}catch(error){mismatch=error.code;}
      const saved=await auth.saveEnrollment({...data,revision:wrong.revision,firstName});const challenge=await auth.submitEnrollment({revision:saved.revision});
      await auth.verifyEmail({challengeId:challenge.challengeId,code:'123456'});const admittedWithoutSession=await auth.me();
      const login=await auth.login({email,password});const exported=await settings.get();
      const education=await profiles.education.list();if(education.length!==1||education[0].institution!=='Հայաստանի ազգային պոլիտեխնիկական համալսարան'||education[0].institute!==options.institutes[0].name)throw new Error('Enrollment education was not persisted');
      const privateFields=Object.keys(login.user).filter(key=>['enrollment','registryClaim','diplomaNumber'].includes(key));
      await settings.deleteAccount({password});
      return {registered:registered.status,before,denied,mismatch,admittedWithoutSession,role:login.user.role,onboarded:login.user.onboardingComplete,privateFields,settings:!!exported};
    },role);
    assert.deepEqual(result,{registered:'enrollment',before:null,denied:'UNAUTHORIZED',mismatch:'REGISTRY_MISMATCH',admittedWithoutSession:null,role,onboarded:true,privateFields:[],settings:true});
    await context.close();
  }
  console.log('Enrollment mock browser acceptance passed: both registries, restricted access, editable mismatches, email admission, private fields and deletion.');
}finally{await browser.close();}
