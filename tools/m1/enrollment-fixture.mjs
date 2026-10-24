// Explicit synthetic registry enrollment for disposable browser acceptance databases.
export async function registerForVerification(page,data) {
  return page.evaluate(async data=>{
    const {auth}=await import('/js/services/index.js');
    await auth.register(data);
    const state=await auth.enrollment(),options=await auth.enrollmentOptions(),graduate=data.role==='graduate';
    const profile={revision:state.revision,role:data.role,firstName:data.firstName,lastName:data.lastName,
      ...(graduate?{diplomaNumber:data.email,specializationId:options.specializations[0].id,startYear:2021,endYear:2025}:{departmentId:options.departments[0].id,professionId:options.professions[0].id})};
    const saved=await auth.saveEnrollment(profile);
    return auth.submitEnrollment({revision:saved.revision});
  },data);
}
