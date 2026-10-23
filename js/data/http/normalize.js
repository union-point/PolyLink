import { DataError } from '../errors.js';

export function unwrap(value) {
  if (value?.success === false) throw new DataError('SERVICE_ERROR', value.message || 'Չհաջողվեց կատարել գործողությունը։', value.fieldErrors || {});
  return value && typeof value === 'object' && 'data' in value ? value.data : value;
}
const id = value => {
  if (!['string', 'number'].includes(typeof value) || !String(value).trim()) throw new DataError('CONTRACT', 'API պատասխանը չի պարունակում գրառման նույնացուցիչ։');
  return String(value);
};
export function normalizeAuthor(value = {}) { return { id: id(value.id ?? value.UserId), name: value.name || [value.firstName ?? value.FirstName, value.lastName ?? value.LastName].filter(Boolean).join(' '), avatar: value.avatar ?? value.ProfilePhotoUrl ?? '' }; }
export function normalizeEducation(value) {
  return { id: id(value.id ?? value.EducationId), institution: value.institution ?? value.universityName ?? value.UniversityName ?? '', degree: value.degree ?? value.Degree ?? '', institute: value.institute ?? value.Institute ?? '', specialization: value.specialization ?? value.Specialization ?? '', startDate: value.startDate?.slice(0, 7) ?? value.StartDate?.slice(0, 7) ?? '', endDate: value.endDate?.slice(0, 7) ?? value.EndDate?.slice(0, 7) ?? null, logo: value.logo ?? value.LogoUrl ?? '' };
}
export function normalizeCertificate(value) { return { id: id(value.id ?? value.CertificateId), name: value.name ?? value.title ?? value.CertificateName ?? '', organization: value.organization ?? value.issuer ?? value.Organization ?? '', issueDate: (value.issueDate ?? value.date ?? value.IssueDate)?.slice(0, 7) ?? null, credentialUrl: value.credentialUrl ?? value.credential ?? value.Url ?? '', logo: value.logo || '' }; }
export function normalizeUser(value) {
  if (!value) return null;
  const firstName = value.firstName ?? value.FirstName ?? '', lastName = value.lastName ?? value.LastName ?? '';
  const role = value.role ?? value.RoleName;
  if (!['graduate', 'lecturer', 'teacher'].includes(role) || typeof value.onboardingComplete !== 'boolean') throw new DataError('CONTRACT', 'API պրոֆիլի դերը կամ լրացման վիճակը սահմանված չէ։');
  return { canOpenProfile: value.canOpenProfile !== false, id: id(value.id ?? value.UserId), firstName, lastName, name: value.name || `${firstName} ${lastName}`.trim(), jobTitle: value.jobTitle ?? value.Specialization ?? '', description: value.description ?? value.About ?? '', avatar: value.avatar ?? value.ProfilePhotoUrl ?? '', cover: value.cover ?? value.CoverPhotoUrl ?? '', email: value.email ?? value.Email, role: role === 'teacher' ? 'lecturer' : role, onboardingComplete: value.onboardingComplete, passwordChangedAt: value.passwordChangedAt ?? value.PasswordChangedAt ?? null, institute: value.institute ?? value.Institute ?? '', specialization: value.specialization ?? value.Specialization ?? '', graduationYear: String(value.graduationYear ?? value.GraduationYear ?? ''), education: (value.education || []).map(normalizeEducation), licenses: (value.licenses || value.certificates || []).map(normalizeCertificate) };
}
export function normalizeComment(value) { return { id: id(value.id ?? value.CommentId), postId: id(value.postId ?? value.PostId), text: value.text ?? value.Content ?? '', createdAt: value.createdAt ?? value.CreatedAt, author: normalizeAuthor(value.author) }; }
export function normalizePost(value) { return { id: id(value.id ?? value.PostId), title: value.title ?? value.Title ?? '', content: value.content ?? value.Content ?? '', category: value.category ?? value.postTypeCode ?? '', sphere: value.sphere ?? value.sphereCode ?? '', createdAt: value.createdAt ?? value.CreatedAt, author: normalizeAuthor(value.author), comments: (value.comments || []).map(normalizeComment) }; }
export function normalizeTopic(value) { return { id: id(value.id ?? value.TopicId), title: value.title ?? value.Title ?? '', content: value.content ?? value.Content ?? '', major: value.major ?? '', createdAt: value.createdAt ?? value.CreatedAt, author: normalizeAuthor(value.author), replyCount: Number(value.replyCount ?? value.ReplyCount ?? 0) }; }
export function list(value, normalize) {
  if (!Array.isArray(value)) throw new DataError('CONTRACT', 'API պատասխանի ցուցակի ձևաչափը սխալ է։');
  return value.map(normalize);
}
