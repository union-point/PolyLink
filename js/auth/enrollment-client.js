// Enrollment has a separate cookie and never restores an application session or opens a vault.
export function createEnrollmentClient(api) {
  return {
    uploadEnrollmentAvatar: content => api.request({method:'put',url:'/auth/enrollment/avatar',data:{content}}),
    removeEnrollmentAvatar: () => api.request({method:'delete',url:'/auth/enrollment/avatar'}),
    enrollment: () => api.request({method:'get',url:'/auth/enrollment'}),
    enrollmentOptions: () => api.request({method:'get',url:'/auth/enrollment/options'}),
    saveEnrollment: data => api.request({method:'put',url:'/auth/enrollment/profile',data}),
    submitEnrollment: data => api.request({method:'post',url:'/auth/enrollment/submit',data}),
    logoutEnrollment: () => api.request({method:'post',url:'/auth/enrollment/logout',data:{}}),
  };
}
