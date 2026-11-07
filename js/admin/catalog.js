export const catalog = Object.freeze({
 universities:{label:'Համալսարաններ',singular:'Համալսարան',nameLimit:255},
 institutes:{label:'Ինստիտուտներ / ֆակուլտետներ',singular:'Ինստիտուտ / ֆակուլտետ',nameLimit:255},
 departments:{label:'Ամբիոններ',singular:'Ամբիոն',nameLimit:255},
 specializations:{label:'Մասնագիտություններ',singular:'Մասնագիտություն',nameLimit:255},
 professions:{label:'Մասնագիտական ուղղություններ',singular:'Մասնագիտական ուղղություն',nameLimit:150},
 degrees:{label:'Կրթական աստիճաններ',singular:'Կրթական աստիճան',nameLimit:100},
 'post-types':{label:'Հայտարարությունների տեսակներ',singular:'Հայտարարության տեսակ',nameLimit:100,codeLimit:16},
 'post-spheres':{label:'Հայտարարությունների ուղղություններ',singular:'Հայտարարության ուղղություն',nameLimit:150,codeLimit:32},
 'forum-categories':{label:'Ֆորումի բաժիններ',singular:'Ֆորումի բաժին',nameLimit:255,codeLimit:32},
 lecturers:{label:'Դասախոսներ',singular:'Դասախոսի գրառում'},
 alumni:{label:'Շրջանավարտներ',singular:'Շրջանավարտի գրառում'},
});
export const messages = Object.freeze({
 SYSTEM_VALUE:'Համակարգային արժեք․ փոփոխել կամ հեռացնել հնարավոր չէ։',
 REFERENCE_IN_USE:'Արժեքն օգտագործվում է․ փոփոխել կամ հեռացնել հնարավոր չէ։',
 RECORD_LINKED:'Գրառումը կապված է օգտատիրոջ հետ․ փոփոխել կամ հեռացնել հնարավոր չէ։',
 VERSION_CONFLICT:'Գրառումն արդեն փոփոխվել է։ Թարմացրեք այն՝ շարունակելու համար։',
 DUPLICATE_NAME:'Այս անվանումն արդեն առկա է։',DUPLICATE_CODE:'Այս կոդն արդեն առկա է։',
 DUPLICATE_EMAIL:'Այս էլ. փոստով գրառում արդեն առկա է։',DUPLICATE_DIPLOMA:'Այս դիպլոմի համարով գրառում արդեն առկա է։',
 UNAUTHORIZED:'Մուտքի ժամկետն ավարտվել է։ Կրկին մուտք գործեք։',
 FORBIDDEN:'Այս գործողությունը հասանելի չէ։',NOT_FOUND:'Գրառումն այլևս հասանելի չէ։',
 REFERENCE_BUSY:'Գրառումը զբաղված է։ Կրկին փորձեք։',REGISTRY_BUSY:'Գրառումը զբաղված է։ Կրկին փորձեք։',
});
export const errorText = error => messages[error.code] || (error.code==='VALIDATION'?'Ստուգեք լրացված դաշտերը։':error.code==='NETWORK'?error.message:'Չհաջողվեց կատարել գործողությունը։ Կրկին փորձեք։');
