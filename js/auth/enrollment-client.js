// Enrollment has a separate cookie and never restores an application session or opens a vault.
export function createEnrollmentClient(api) {
  let avatarOperation;
  return {
    uploadEnrollmentAvatar: (content,expectedPhotoId=null) => {
      if(!avatarOperation||avatarOperation.content!==content||avatarOperation.expectedPhotoId!==expectedPhotoId)avatarOperation={content,expectedPhotoId,operationId:crypto.randomUUID()};
      return api.request({method:'put',url:'/auth/enrollment/avatar',data:avatarOperation}).then(result=>{avatarOperation=null;return result;}).catch(error=>{if(!error.retryable)avatarOperation=null;throw error;});
    },
    removeEnrollmentAvatar: expectedPhotoId => api.request({method:'delete',url:'/auth/enrollment/avatar',params:{expectedPhotoId}}),
    enrollment: () => api.request({method:'get',url:'/auth/enrollment'}),
    enrollmentOptions: () => api.request({method:'get',url:'/auth/enrollment/options'}),
    saveEnrollment: data => api.request({method:'put',url:'/auth/enrollment/profile',data}),
    submitEnrollment: data => api.request({method:'post',url:'/auth/enrollment/submit',data}),
    logoutEnrollment: () => api.request({method:'post',url:'/auth/enrollment/logout',data:{}}),
  };
}
