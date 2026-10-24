/**
 * Application contracts. Providers return these objects, never Axios responses.
 * IDs are opaque strings; dates use YYYY-MM (profile precision), timestamps ISO UTC.
 *
 * @typedef {{id:string, firstName:string, lastName:string, name:string,
 * jobTitle:string, description:string, avatar:string, cover:string,
 * role:'graduate'|'lecturer', onboardingComplete:boolean, email?:string,
 * institute:string, specialization:string, graduationYear:string,
 * department?:string, passwordChangedAt?:string|null,
 * education:Education[], licenses:Certificate[]}} User
 * @typedef {{id:string, institution:string, degree:string, institute:string,
 * specialization:string, startDate:string, endDate:string|null, logo:string}} Education
 * @typedef {{id:string, name:string, organization:string, issueDate:string|null,
 * credentialUrl:string, logo:string}} Certificate
 * @typedef {{id:string,name:string,avatar:string}} Author
 * @typedef {{id:string,postId:string,text:string,createdAt:string,author:Author}} Comment
 * @typedef {{id:string,title:string,content:string,category:string,sphere:string,
 * createdAt:string,author:Author,comments:Comment[]}} Post
 * @typedef {{id:string|null,name:string,avatar:string,canOpenProfile:boolean}} ForumAuthor
 * @typedef {{id:string,code:string,name:string}} ForumCategory
 * @typedef {{id:string,title:string,categoryCode:string,categoryName:string,content:string,excerpt:string,
 * createdAt:string,updatedAt:string|null,version:string,author:ForumAuthor,replyCount:number,
 * canEdit:boolean,canDelete:boolean}} Topic
 * @typedef {{id:string,topicId:string,content:string,createdAt:string,updatedAt:string|null,version:string,
 * author:ForumAuthor,likeCount:number,liked:boolean,isTopicAuthor:boolean,canEdit:boolean,canDelete:boolean}} Reply
 * @typedef {{id:string,isGroup:boolean,closed:boolean,name:string,participants:Author[],
 * muted:boolean,blocked:boolean,unreadCount:number,lastMessage:Message|null}} Conversation
 * @typedef {{id:string,roomId:string,sender:Author,text:string,createdAt:string,
 * attachment:{url:string,name:string,type:string}|null}} Message
 * @typedef {{isProfilePublic:boolean,showEmail:boolean,twoFactorEnabled:boolean,
 * language:string,emailEnabled:boolean,newListingNotifications:boolean,
 * forumReplyNotifications:boolean,directMessageNotifications:boolean}} Settings
 * @typedef {{status:'authenticated',user:User}|{status:'challenge',challengeId:string,
 * expiresAt?:number,resendAfter?:number}} LoginResult
 */
export const categories = Object.freeze({ job: 'Աշխատանք', internship: 'Պրակտիկա', training: 'Դասընթաց' });
export const majors = Object.freeze({
  informatics: 'Ինֆորմատիկա և ծրագրավորում', mechanics: 'Մեքենաշինություն և ռոբոտաշինություն',
  electronics: 'Էլեկտրոնիկա և հեռահաղորդակցություն', civil: 'Շինարարություն և ճարտարապետություն',
  energy: 'Էներգետիկա և կայուն զարգացում', management: 'Տեխնիկական կառավարում և տնտեսագիտություն',
});
