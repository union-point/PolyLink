// Decorative third-party assets must not control auth/chat acceptance readiness.
// Application scripts, pinned local crypto, captured mail and API calls still run in full.
export async function isolateDecorativeAssets(context){
  for(const host of ['cdnjs.cloudflare.com','fonts.googleapis.com','fonts.gstatic.com','images.unsplash.com','images.pexels.com']){
    await context.route(`https://${host}/**`,route=>route.fulfill(route.request().resourceType()==='stylesheet'?{status:200,contentType:'text/css',body:''}:{status:204,body:''}));
  }
}
