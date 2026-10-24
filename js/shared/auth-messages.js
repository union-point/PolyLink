// Keep transport and browser errors out of the Armenian authentication interface.
const messages = {
  UNAUTHORIZED: 'Չհաջողվեց հաստատել տվյալները։ Ստուգեք մուտքագրված տվյալները կամ կրկին մուտք գործեք։',
  FORBIDDEN: 'Այս գործողության համար անհրաժեշտ է կրկին հաստատել Ձեր ինքնությունը։',
  VALIDATION: 'Խնդրում ենք ստուգել լրացված տվյալները։',
  NETWORK: 'Կապը սերվերի հետ ընդհատվել է։ Ստուգեք ինտերնետային կապը և կրկին փորձեք։',
  SERVICE_ERROR: 'Չհաջողվեց կատարել գործողությունը։ Խնդրում ենք կրկին փորձել։',
  SERVICE_UNAVAILABLE: 'Ծառայությունը ժամանակավորապես անհասանելի է։ Խնդրում ենք փորձել ավելի ուշ։',
  RATE_LIMITED: 'Փորձերի քանակը գերազանցված է։ Խնդրում ենք սպասել և կրկին փորձել։',
  REVISION_CONFLICT: 'Տվյալները փոխվել են մեկ այլ ներդիրում։ Թարմացրեք էջը և կրկին փորձեք։',
  CONFLICT: 'Տվյալները փոխվել են։ Թարմացրեք էջը և կրկին փորձեք։',
  SESSION_CHANGED: 'Մուտքի վիճակը փոխվել է։ Խնդրում ենք կրկին մուտք գործել։',
  REGISTRY_MISMATCH: 'Գրանցամատյանում համապատասխան տվյալներ չեն գտնվել։ Ստուգեք տվյալները կամ դիմեք համալսարանին։',
  REGISTRY_CLAIMED: 'Այս գրառումն արդեն կապված է մեկ այլ հաշվի հետ։ Դիմեք համալսարանին։',
  RECOVERY_EXPIRED: 'Վերականգնման ժամկետը լրացել է։ Պահանջեք նոր վերականգնման կոդ։',
  RECOVERY_RESTART: 'Վերականգնումը շարունակելու տվյալները բացակայում են։ Պահանջեք նոր վերականգնման կոդ։',
  STORAGE_UNAVAILABLE: 'Շարունակելու համար թույլատրեք տվյալների պահպանումն այս դիտարկիչում։',
  DATA_INTEGRITY: 'Չհաջողվեց բացել հաշվի գաղտնագրված տվյալները։ Կրկին մուտք գործեք։',
  KEY_LOCKED: 'Մուտքագրեք Ձեր գաղտնաբառը՝ շարունակելու համար։',
  NOT_FOUND: 'Պահանջված տվյալները չեն գտնվել։ Վերադարձեք և կրկին փորձեք։',
};
const translations = {
  'Incorrect code': 'Հաստատման կոդը սխալ է։ Ստուգեք այն և կրկին փորձեք։',
  'Use 8–128 characters, including an uppercase letter, number and symbol.': 'Գաղտնաբառը պետք է պարունակի 8–128 նիշ, առնվազն մեկ լատինական մեծատառ, թիվ և հատուկ նիշ։',
  'Enter the same new password used to prepare this recovery.': 'Մուտքագրեք այն նոր գաղտնաբառը, որն ընտրել եք վերականգնման սկզբում։',
  'The current password is incorrect.': 'Ընթացիկ գաղտնաբառը սխալ է։',
  'Start signing in again.': 'Վավերացման ժամկետը լրացել է։ Կրկին մուտք գործեք։',
  'Use your polytechnic.am email address.': 'Օգտագործեք Ձեր name@polytechnic.am էլ․ փոստի հասցեն։',
};
export function authMessage(message, code) {
  if (typeof message === 'string' && /[\u0531-\u0587]/u.test(message)) return message;
  return translations[message] || messages[code] || 'Չհաջողվեց կատարել գործողությունը։ Խնդրում ենք կրկին փորձել։';
}
export const isAuthPage = () => Boolean(document.querySelector('link[href$="auth.css"]'));

export function validateAuthForm(form) {
  if (form.tagName !== 'FORM') return null;
  for (const input of form.querySelectorAll('input,select,textarea')) {
    if (!input.willValidate || input.checkValidity()) continue;
    let message = 'Ստուգեք դաշտի արժեքը։';
    const validity = input.validity;
    if (validity.valueMissing) message = 'Խնդրում ենք լրացնել այս դաշտը։';
    else if (validity.typeMismatch) message = 'Մուտքագրեք վավեր էլ․ փոստի հասցե։';
    else if (validity.patternMismatch) message = input.inputMode === 'numeric' ? 'Մուտքագրեք վեցանիշ կոդը։' : 'Ստուգեք մուտքագրված տվյալների ձևաչափը։';
    else if (validity.rangeUnderflow || validity.rangeOverflow || validity.badInput) message = `Մուտքագրեք թիվ՝ ${input.min}–${input.max} միջակայքում։`;
    input.focus();
    return { code: 'VALIDATION', message, fieldErrors: { [input.name || input.id]: message } };
  }
  return null;
}
