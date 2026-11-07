-- Reviewed public reference snapshot from local polylink; no identities or local IDs.
-- Match migration-provided records by stable code/name; keep target identity IDs.

-- Institutes (6 source records)
IF NOT EXISTS (SELECT 1 FROM dbo.Institutes WHERE Name=N'ԷԷ')
    INSERT dbo.Institutes(Name) VALUES (N'ԷԷ');
IF NOT EXISTS (SELECT 1 FROM dbo.Institutes WHERE Name=N'ԻՔՏ')
    INSERT dbo.Institutes(Name) VALUES (N'ԻՔՏ');
IF NOT EXISTS (SELECT 1 FROM dbo.Institutes WHERE Name=N'ԼՔՏ')
    INSERT dbo.Institutes(Name) VALUES (N'ԼՔՏ');
IF NOT EXISTS (SELECT 1 FROM dbo.Institutes WHERE Name=N'ԿՄ')
    INSERT dbo.Institutes(Name) VALUES (N'ԿՄ');
IF NOT EXISTS (SELECT 1 FROM dbo.Institutes WHERE Name=N'ՄՄՏՀԴ')
    INSERT dbo.Institutes(Name) VALUES (N'ՄՄՏՀԴ');
IF NOT EXISTS (SELECT 1 FROM dbo.Institutes WHERE Name=N'ՏՀՏԷ')
    INSERT dbo.Institutes(Name) VALUES (N'ՏՀՏԷ');

-- Departments (14 source records)
IF NOT EXISTS (SELECT 1 FROM dbo.Departments WHERE Name=N'Աստվածաբանության և ազգագրության բաժին')
    INSERT dbo.Departments(Name) VALUES (N'Աստվածաբանության և ազգագրության բաժին');
IF NOT EXISTS (SELECT 1 FROM dbo.Departments WHERE Name=N'Բանասիրական ֆակուլտետ')
    INSERT dbo.Departments(Name) VALUES (N'Բանասիրական ֆակուլտետ');
IF NOT EXISTS (SELECT 1 FROM dbo.Departments WHERE Name=N'Գործիքային կատարողականության ֆակուլտետ')
    INSERT dbo.Departments(Name) VALUES (N'Գործիքային կատարողականության ֆակուլտետ');
IF NOT EXISTS (SELECT 1 FROM dbo.Departments WHERE Name=N'Ինֆորմատիկայի և կիրառական մաթեմատիկայի ֆակուլտետ')
    INSERT dbo.Departments(Name) VALUES (N'Ինֆորմատիկայի և կիրառական մաթեմատիկայի ֆակուլտետ');
IF NOT EXISTS (SELECT 1 FROM dbo.Departments WHERE Name=N'Ինֆորմացիոն տեխնոլոգիաների կենտրոն')
    INSERT dbo.Departments(Name) VALUES (N'Ինֆորմացիոն տեխնոլոգիաների կենտրոն');
IF NOT EXISTS (SELECT 1 FROM dbo.Departments WHERE Name=N'Իրավագիտության ֆակուլտետ')
    INSERT dbo.Departments(Name) VALUES (N'Իրավագիտության ֆակուլտետ');
IF NOT EXISTS (SELECT 1 FROM dbo.Departments WHERE Name=N'Կիրառական Մաթեմատիկա')
    INSERT dbo.Departments(Name) VALUES (N'Կիրառական Մաթեմատիկա');
IF NOT EXISTS (SELECT 1 FROM dbo.Departments WHERE Name=N'Ճարտարապետության և շինարարության ֆակուլտետ')
    INSERT dbo.Departments(Name) VALUES (N'Ճարտարապետության և շինարարության ֆակուլտետ');
IF NOT EXISTS (SELECT 1 FROM dbo.Departments WHERE Name=N'Մանկավարժության և կրթության զարգացման կենտրոն')
    INSERT dbo.Departments(Name) VALUES (N'Մանկավարժության և կրթության զարգացման կենտրոն');
IF NOT EXISTS (SELECT 1 FROM dbo.Departments WHERE Name=N'Պատմության և հասարակագիտության ֆակուլտետ')
    INSERT dbo.Departments(Name) VALUES (N'Պատմության և հասարակագիտության ֆակուլտետ');
IF NOT EXISTS (SELECT 1 FROM dbo.Departments WHERE Name=N'Պատմության ֆակուլտետ')
    INSERT dbo.Departments(Name) VALUES (N'Պատմության ֆակուլտետ');
IF NOT EXISTS (SELECT 1 FROM dbo.Departments WHERE Name=N'Տնտեսագիտության և կառավարման ֆակուլտետ')
    INSERT dbo.Departments(Name) VALUES (N'Տնտեսագիտության և կառավարման ֆակուլտետ');
IF NOT EXISTS (SELECT 1 FROM dbo.Departments WHERE Name=N'Փիլիսոփայության և հոգեբանության ֆակուլտետ')
    INSERT dbo.Departments(Name) VALUES (N'Փիլիսոփայության և հոգեբանության ֆակուլտետ');
IF NOT EXISTS (SELECT 1 FROM dbo.Departments WHERE Name=N'Ֆիզիկական դաստիարակության ամբիոն')
    INSERT dbo.Departments(Name) VALUES (N'Ֆիզիկական դաստիարակության ամբիոն');

-- Specializations (68 source records)
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Ալգորիթմների տեսություն';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Ալգորիթմների տեսություն')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Ալգորիթմների տեսություն',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Ամպային տեխնոլոգիաներ';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Ամպային տեխնոլոգիաներ')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Ամպային տեխնոլոգիաներ',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'ավտոմատացում';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'ավտոմատացում')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'ավտոմատացում',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Ավտոմատացում (071402.00.6)';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Ավտոմատացում (071402.00.6)')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Ավտոմատացում (071402.00.6)',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Ավտոմատացված համակարգեր';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Ավտոմատացված համակարգեր')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Ավտոմատացված համակարգեր',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Ատոմային էներգետիկա';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Ատոմային էներգետիկա')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Ատոմային էներգետիկա',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Գեոդեզիա';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Գեոդեզիա')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Գեոդեզիա',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Դիզայն և գրաֆիկա';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Դիզայն և գրաֆիկա')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Դիզայն և գրաֆիկա',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Էլեկտրական ցանցեր';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Էլեկտրական ցանցեր')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Էլեկտրական ցանցեր',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Էլեկտրատեխնիկա';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Էլեկտրատեխնիկա')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Էլեկտրատեխնիկա',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Էլեկտրոնիկա';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Էլեկտրոնիկա')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Էլեկտրոնիկա',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Էլեկտրոնիկա (071401.00.6)';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Էլեկտրոնիկա (071401.00.6)')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Էլեկտրոնիկա (071401.00.6)',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Էներգաարդյունավետություն';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Էներգաարդյունավետություն')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Էներգաարդյունավետություն',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Էներգետիկ մենեջմենթ';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Էներգետիկ մենեջմենթ')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Էներգետիկ մենեջմենթ',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Էներգետիկա';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Էներգետիկա')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Էներգետիկա',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Ինֆորմատիկա';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Ինֆորմատիկա')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Ինֆորմատիկա',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Ինֆորմատիկա և հաշվողական տեխնիկա';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Ինֆորմատիկա և հաշվողական տեխնիկա')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Ինֆորմատիկա և հաշվողական տեխնիկա',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Լեռնային գործ և մետալուրգիա';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Լեռնային գործ և մետալուրգիա')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Լեռնային գործ և մետալուրգիա',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Լեռնային մեքենաներ և սարքավորումներ';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Լեռնային մեքենաներ և սարքավորումներ')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Լեռնային մեքենաներ և սարքավորումներ',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Ծրագրային ճարտարագիտություն';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Ծրագրային ճարտարագիտություն')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Ծրագրային ճարտարագիտություն',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Ծրագրային ճարտարագիտություն (061102.00.6)';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Ծրագրային ճարտարագիտություն (061102.00.6)')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Ծրագրային ճարտարագիտություն (061102.00.6)',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Կապի համակարգեր';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Կապի համակարգեր')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Կապի համակարգեր',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Կառավարման համակարգեր';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Կառավարման համակարգեր')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Կառավարման համակարգեր',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Կիբերանվտանգություն';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Կիբերանվտանգություն')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Կիբերանվտանգություն',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Կիրառական մաթեմատիկա';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Կիրառական մաթեմատիկա')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Կիրառական մաթեմատիկա',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Կիրառական վիճակագրություն';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Կիրառական վիճակագրություն')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Կիրառական վիճակագրություն',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Համակարգչային գրաֆիկա';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Համակարգչային գրաֆիկա')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Համակարգչային գրաֆիկա',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Համակարգչային համակարգեր և ցանցեր';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Համակարգչային համակարգեր և ցանցեր')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Համակարգչային համակարգեր և ցանցեր',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'համակարգչային ճարտարագիտություն';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'համակարգչային ճարտարագիտություն')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'համակարգչային ճարտարագիտություն',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Համակարգչային ճարտարագիտություն (061103.00.6)';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Համակարգչային ճարտարագիտություն (061103.00.6)')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Համակարգչային ճարտարագիտություն (061103.00.6)',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Հեռահաղորդակցության ցանցեր';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Հեռահաղորդակցության ցանցեր')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Հեռահաղորդակցության ցանցեր',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Հեռահաղորդակցություն';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Հեռահաղորդակցություն')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Հեռահաղորդակցություն',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Ճշգրիտ մեխանիկա';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Ճշգրիտ մեխանիկա')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Ճշգրիտ մեխանիկա',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Մաթեմատիկական մոդելավորում';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Մաթեմատիկական մոդելավորում')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Մաթեմատիկական մոդելավորում',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Մետալուրգիա';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Մետալուրգիա')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Մետալուրգիա',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Մեքենաշինություն';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Մեքենաշինություն')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Մեքենաշինություն',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Մեքենաշինություն և նյութերի մշակում';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Մեքենաշինություն և նյութերի մշակում')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Մեքենաշինություն և նյութերի մշակում',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Մուլտիմեդիա տեխնոլոգիաներ';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Մուլտիմեդիա տեխնոլոգիաներ')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Մուլտիմեդիա տեխնոլոգիաներ',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Շրջակա միջավայրի պահպանություն';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Շրջակա միջավայրի պահպանություն')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Շրջակա միջավայրի պահպանություն',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Ջերմաէներգետիկա';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Ջերմաէներգետիկա')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Ջերմաէներգետիկա',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Ջերմային էներգետիկա';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Ջերմային էներգետիկա')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Ջերմային էներգետիկա',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Ռադիոտեխնիկա';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Ռադիոտեխնիկա')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Ռադիոտեխնիկա',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'ռադիոտեխնիկա և կապ';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'ռադիոտեխնիկա և կապ')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'ռադիոտեխնիկա և կապ',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Ռադիոտեխնիկա և կապ (071403.00.6)';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Ռադիոտեխնիկա և կապ (071403.00.6)')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Ռադիոտեխնիկա և կապ (071403.00.6)',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Ռոբոտատեխնիկա';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Ռոբոտատեխնիկա')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Ռոբոտատեխնիկա',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Ռոբոտատեխնիկական համակարգեր';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Ռոբոտատեխնիկական համակարգեր')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Ռոբոտատեխնիկական համակարգեր',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'սարքաշինություն և չափագիտություն';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'սարքաշինություն և չափագիտություն')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'սարքաշինություն և չափագիտություն',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Սարքաշինություն և չափագիտություն (071506.00.6)';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Սարքաշինություն և չափագիտություն (071506.00.6)')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Սարքաշինություն և չափագիտություն (071506.00.6)',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Վերականգնվող էներգետիկայի համակարգեր';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Վերականգնվող էներգետիկայի համակարգեր')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Վերականգնվող էներգետիկայի համակարգեր',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Վիճակագրություն';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Վիճակագրություն')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Վիճակագրություն',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Տեղեկատվական անվտանգություն';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Տեղեկատվական անվտանգություն')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Տեղեկատվական անվտանգություն',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Տեղեկատվական անվտանգություն (061901.00.6)';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Տեղեկատվական անվտանգություն (061901.00.6)')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Տեղեկատվական անվտանգություն (061901.00.6)',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Տեղեկատվական համակարգեր';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Տեղեկատվական համակարգեր')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Տեղեկատվական համակարգեր',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Տեղեկատվական համակարգեր (061104.00.6)';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Տեղեկատվական համակարգեր (061104.00.6)')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Տեղեկատվական համակարգեր (061104.00.6)',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Տեղեկատվական համակարգերի կառավարում';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Տեղեկատվական համակարգերի կառավարում')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Տեղեկատվական համակարգերի կառավարում',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'տեղեկատվական տեխնոլոգիաներ';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'տեղեկատվական տեխնոլոգիաներ')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'տեղեկատվական տեխնոլոգիաներ',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Տեղեկատվական տեխնոլոգիաներ (061105.00.6)';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Տեղեկատվական տեխնոլոգիաներ (061105.00.6)')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Տեղեկատվական տեխնոլոգիաներ (061105.00.6)',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Տվյալների գիտություն';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Տվյալների գիտություն')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Տվյալների գիտություն',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Տրանսպորտային համակարգեր';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Տրանսպորտային համակարգեր')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Տրանսպորտային համակարգեր',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Տրանսպորտային միջոցներ';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Տրանսպորտային միջոցներ')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Տրանսպորտային միջոցներ',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Ցանցային կառավարում';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Ցանցային կառավարում')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Ցանցային կառավարում',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Ցանցային տեխնոլոգիաներ';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Ցանցային տեխնոլոգիաներ')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Ցանցային տեխնոլոգիաներ',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Քիմիական տեխնոլոգիա';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Քիմիական տեխնոլոգիա')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Քիմիական տեխնոլոգիա',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Քիմիական տեխնոլոգիաներ';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Քիմիական տեխնոլոգիաներ')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Քիմիական տեխնոլոգիաներ',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Օգտակար հանածոների հետախուզում';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Օգտակար հանածոների հետախուզում')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Օգտակար հանածոների հետախուզում',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Օպտիկական կապ';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Օպտիկական կապ')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Օպտիկական կապ',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Օպտիմալացման մեթոդներ';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Օպտիմալացման մեթոդներ')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Օպտիմալացման մեթոդներ',0);
UPDATE dbo.Specializations SET IsVerified=0 WHERE Name=N'Ֆինանսական մաթեմատիկա';
IF NOT EXISTS (SELECT 1 FROM dbo.Specializations WHERE Name=N'Ֆինանսական մաթեմատիկա')
    INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Ֆինանսական մաթեմատիկա',0);

-- Professions (14 source records)
IF NOT EXISTS (SELECT 1 FROM dbo.Professions WHERE Name=N'Ալգորիթմների տեսություն')
    INSERT dbo.Professions(Name) VALUES (N'Ալգորիթմների տեսություն');
IF NOT EXISTS (SELECT 1 FROM dbo.Professions WHERE Name=N'Բարոյագիտություն (Էթիկա)')
    INSERT dbo.Professions(Name) VALUES (N'Բարոյագիտություն (Էթիկա)');
IF NOT EXISTS (SELECT 1 FROM dbo.Professions WHERE Name=N'Դիսկրետ մաթեմատիկա')
    INSERT dbo.Professions(Name) VALUES (N'Դիսկրետ մաթեմատիկա');
IF NOT EXISTS (SELECT 1 FROM dbo.Professions WHERE Name=N'Ժողովրդական նվագարաններ')
    INSERT dbo.Professions(Name) VALUES (N'Ժողովրդական նվագարաններ');
IF NOT EXISTS (SELECT 1 FROM dbo.Professions WHERE Name=N'Հայ նոր գրականություն')
    INSERT dbo.Professions(Name) VALUES (N'Հայ նոր գրականություն');
IF NOT EXISTS (SELECT 1 FROM dbo.Professions WHERE Name=N'հայոց պատմություն')
    INSERT dbo.Professions(Name) VALUES (N'հայոց պատմություն');
IF NOT EXISTS (SELECT 1 FROM dbo.Professions WHERE Name=N'Մաթ. անալիզ')
    INSERT dbo.Professions(Name) VALUES (N'Մաթ. անալիզ');
IF NOT EXISTS (SELECT 1 FROM dbo.Professions WHERE Name=N'Մակրոտնտեսագիտություն')
    INSERT dbo.Professions(Name) VALUES (N'Մակրոտնտեսագիտություն');
IF NOT EXISTS (SELECT 1 FROM dbo.Professions WHERE Name=N'Մարզչական գործ')
    INSERT dbo.Professions(Name) VALUES (N'Մարզչական գործ');
IF NOT EXISTS (SELECT 1 FROM dbo.Professions WHERE Name=N'Միջնադարագիտություն')
    INSERT dbo.Professions(Name) VALUES (N'Միջնադարագիտություն');
IF NOT EXISTS (SELECT 1 FROM dbo.Professions WHERE Name=N'Մշակութային մարդաբանություն')
    INSERT dbo.Professions(Name) VALUES (N'Մշակութային մարդաբանություն');
IF NOT EXISTS (SELECT 1 FROM dbo.Professions WHERE Name=N'Նախադպրոցական մանկավարժություն')
    INSERT dbo.Professions(Name) VALUES (N'Նախադպրոցական մանկավարժություն');
IF NOT EXISTS (SELECT 1 FROM dbo.Professions WHERE Name=N'Սահմանադրական իրավունք')
    INSERT dbo.Professions(Name) VALUES (N'Սահմանադրական իրավունք');
IF NOT EXISTS (SELECT 1 FROM dbo.Professions WHERE Name=N'Քաղաքաշինություն')
    INSERT dbo.Professions(Name) VALUES (N'Քաղաքաշինություն');

-- Degrees (2 source records)
IF NOT EXISTS (SELECT 1 FROM dbo.Degrees WHERE Name=N'Բակալավր')
    INSERT dbo.Degrees(Name) VALUES (N'Բակալավր');
IF NOT EXISTS (SELECT 1 FROM dbo.Degrees WHERE Name=N'Մագիստրոս')
    INSERT dbo.Degrees(Name) VALUES (N'Մագիստրոս');

-- Universities (1 source records)
UPDATE dbo.Universities SET IsVerified=0,LogoUrl=NULL WHERE Name=N'Հայաստանի ազգային պոլիտեխնիկական համալսարան';
IF NOT EXISTS (SELECT 1 FROM dbo.Universities WHERE Name=N'Հայաստանի ազգային պոլիտեխնիկական համալսարան')
    INSERT dbo.Universities(Name,IsVerified,LogoUrl) VALUES (N'Հայաստանի ազգային պոլիտեխնիկական համալսարան',0,NULL);

-- Languages (3 source records)
UPDATE dbo.Languages SET Name=N'English' WHERE Code=N'en';
IF NOT EXISTS (SELECT 1 FROM dbo.Languages WHERE Code=N'en')
    INSERT dbo.Languages(Code,Name) VALUES (N'en',N'English');
UPDATE dbo.Languages SET Name=N'Հայերեն' WHERE Code=N'hy';
IF NOT EXISTS (SELECT 1 FROM dbo.Languages WHERE Code=N'hy')
    INSERT dbo.Languages(Code,Name) VALUES (N'hy',N'Հայերեն');
UPDATE dbo.Languages SET Name=N'Russian' WHERE Code=N'ru';
IF NOT EXISTS (SELECT 1 FROM dbo.Languages WHERE Code=N'ru')
    INSERT dbo.Languages(Code,Name) VALUES (N'ru',N'Russian');

-- Roles (2 source records)
IF NOT EXISTS (SELECT 1 FROM dbo.Roles WHERE Name=N'graduate')
    INSERT dbo.Roles(Name) VALUES (N'graduate');
IF NOT EXISTS (SELECT 1 FROM dbo.Roles WHERE Name=N'lecturer')
    INSERT dbo.Roles(Name) VALUES (N'lecturer');

-- PostTypes (3 source records)
UPDATE dbo.PostTypes SET Name=N'Պրակտիկա' WHERE Code=N'internship';
IF NOT EXISTS (SELECT 1 FROM dbo.PostTypes WHERE Code=N'internship')
    INSERT dbo.PostTypes(Code,Name) VALUES (N'internship',N'Պրակտիկա');
UPDATE dbo.PostTypes SET Name=N'Աշխատանք' WHERE Code=N'job';
IF NOT EXISTS (SELECT 1 FROM dbo.PostTypes WHERE Code=N'job')
    INSERT dbo.PostTypes(Code,Name) VALUES (N'job',N'Աշխատանք');
UPDATE dbo.PostTypes SET Name=N'Դասընթաց' WHERE Code=N'training';
IF NOT EXISTS (SELECT 1 FROM dbo.PostTypes WHERE Code=N'training')
    INSERT dbo.PostTypes(Code,Name) VALUES (N'training',N'Դասընթաց');

-- Spheres (24 source records)
UPDATE dbo.Spheres SET Name=N'Արկածներ' WHERE Code=N'adventure';
IF NOT EXISTS (SELECT 1 FROM dbo.Spheres WHERE Code=N'adventure')
    INSERT dbo.Spheres(Code,Name) VALUES (N'adventure',N'Արկածներ');
UPDATE dbo.Spheres SET Name=N'Գյուղատնտեսություն' WHERE Code=N'agriculture';
IF NOT EXISTS (SELECT 1 FROM dbo.Spheres WHERE Code=N'agriculture')
    INSERT dbo.Spheres(Code,Name) VALUES (N'agriculture',N'Գյուղատնտեսություն');
UPDATE dbo.Spheres SET Name=N'Արվեստ' WHERE Code=N'art';
IF NOT EXISTS (SELECT 1 FROM dbo.Spheres WHERE Code=N'art')
    INSERT dbo.Spheres(Code,Name) VALUES (N'art',N'Արվեստ');
UPDATE dbo.Spheres SET Name=N'Արհեստագործություն' WHERE Code=N'artisan';
IF NOT EXISTS (SELECT 1 FROM dbo.Spheres WHERE Code=N'artisan')
    INSERT dbo.Spheres(Code,Name) VALUES (N'artisan',N'Արհեստագործություն');
UPDATE dbo.Spheres SET Name=N'Բիզնես' WHERE Code=N'business';
IF NOT EXISTS (SELECT 1 FROM dbo.Spheres WHERE Code=N'business')
    INSERT dbo.Spheres(Code,Name) VALUES (N'business',N'Բիզնես');
UPDATE dbo.Spheres SET Name=N'Կինո' WHERE Code=N'cinema';
IF NOT EXISTS (SELECT 1 FROM dbo.Spheres WHERE Code=N'cinema')
    INSERT dbo.Spheres(Code,Name) VALUES (N'cinema',N'Կինո');
UPDATE dbo.Spheres SET Name=N'Խոհարարություն' WHERE Code=N'cuisine';
IF NOT EXISTS (SELECT 1 FROM dbo.Spheres WHERE Code=N'cuisine')
    INSERT dbo.Spheres(Code,Name) VALUES (N'cuisine',N'Խոհարարություն');
UPDATE dbo.Spheres SET Name=N'Էկոլոգիա' WHERE Code=N'ecology';
IF NOT EXISTS (SELECT 1 FROM dbo.Spheres WHERE Code=N'ecology')
    INSERT dbo.Spheres(Code,Name) VALUES (N'ecology',N'Էկոլոգիա');
UPDATE dbo.Spheres SET Name=N'Կրթություն' WHERE Code=N'education';
IF NOT EXISTS (SELECT 1 FROM dbo.Spheres WHERE Code=N'education')
    INSERT dbo.Spheres(Code,Name) VALUES (N'education',N'Կրթություն');
UPDATE dbo.Spheres SET Name=N'Ճարտարագիտություն' WHERE Code=N'engineering';
IF NOT EXISTS (SELECT 1 FROM dbo.Spheres WHERE Code=N'engineering')
    INSERT dbo.Spheres(Code,Name) VALUES (N'engineering',N'Ճարտարագիտություն');
UPDATE dbo.Spheres SET Name=N'Ֆինանսներ' WHERE Code=N'finance';
IF NOT EXISTS (SELECT 1 FROM dbo.Spheres WHERE Code=N'finance')
    INSERT dbo.Spheres(Code,Name) VALUES (N'finance',N'Ֆինանսներ');
UPDATE dbo.Spheres SET Name=N'Առողջություն' WHERE Code=N'health';
IF NOT EXISTS (SELECT 1 FROM dbo.Spheres WHERE Code=N'health')
    INSERT dbo.Spheres(Code,Name) VALUES (N'health',N'Առողջություն');
UPDATE dbo.Spheres SET Name=N'Տեղեկատվական տեխնոլոգիաներ' WHERE Code=N'it';
IF NOT EXISTS (SELECT 1 FROM dbo.Spheres WHERE Code=N'it')
    INSERT dbo.Spheres(Code,Name) VALUES (N'it',N'Տեղեկատվական տեխնոլոգիաներ');
UPDATE dbo.Spheres SET Name=N'Ապրելակերպ' WHERE Code=N'lifestyle';
IF NOT EXISTS (SELECT 1 FROM dbo.Spheres WHERE Code=N'lifestyle')
    INSERT dbo.Spheres(Code,Name) VALUES (N'lifestyle',N'Ապրելակերպ');
UPDATE dbo.Spheres SET Name=N'Գրականություն' WHERE Code=N'literature';
IF NOT EXISTS (SELECT 1 FROM dbo.Spheres WHERE Code=N'literature')
    INSERT dbo.Spheres(Code,Name) VALUES (N'literature',N'Գրականություն');
UPDATE dbo.Spheres SET Name=N'Երաժշտություն' WHERE Code=N'music';
IF NOT EXISTS (SELECT 1 FROM dbo.Spheres WHERE Code=N'music')
    INSERT dbo.Spheres(Code,Name) VALUES (N'music',N'Երաժշտություն');
UPDATE dbo.Spheres SET Name=N'Այլ' WHERE Code=N'other';
IF NOT EXISTS (SELECT 1 FROM dbo.Spheres WHERE Code=N'other')
    INSERT dbo.Spheres(Code,Name) VALUES (N'other',N'Այլ');
UPDATE dbo.Spheres SET Name=N'Լուսանկարչություն' WHERE Code=N'photography';
IF NOT EXISTS (SELECT 1 FROM dbo.Spheres WHERE Code=N'photography')
    INSERT dbo.Spheres(Code,Name) VALUES (N'photography',N'Լուսանկարչություն');
UPDATE dbo.Spheres SET Name=N'Արտադրողականություն' WHERE Code=N'productivity';
IF NOT EXISTS (SELECT 1 FROM dbo.Spheres WHERE Code=N'productivity')
    INSERT dbo.Spheres(Code,Name) VALUES (N'productivity',N'Արտադրողականություն');
UPDATE dbo.Spheres SET Name=N'Հոգեբանություն' WHERE Code=N'psychology';
IF NOT EXISTS (SELECT 1 FROM dbo.Spheres WHERE Code=N'psychology')
    INSERT dbo.Spheres(Code,Name) VALUES (N'psychology',N'Հոգեբանություն');
UPDATE dbo.Spheres SET Name=N'Գիտություն' WHERE Code=N'science';
IF NOT EXISTS (SELECT 1 FROM dbo.Spheres WHERE Code=N'science')
    INSERT dbo.Spheres(Code,Name) VALUES (N'science',N'Գիտություն');
UPDATE dbo.Spheres SET Name=N'Սպորտ' WHERE Code=N'sports';
IF NOT EXISTS (SELECT 1 FROM dbo.Spheres WHERE Code=N'sports')
    INSERT dbo.Spheres(Code,Name) VALUES (N'sports',N'Սպորտ');
UPDATE dbo.Spheres SET Name=N'Տեխնոլոգիաներ' WHERE Code=N'technology';
IF NOT EXISTS (SELECT 1 FROM dbo.Spheres WHERE Code=N'technology')
    INSERT dbo.Spheres(Code,Name) VALUES (N'technology',N'Տեխնոլոգիաներ');
UPDATE dbo.Spheres SET Name=N'Զբոսաշրջություն' WHERE Code=N'tourism';
IF NOT EXISTS (SELECT 1 FROM dbo.Spheres WHERE Code=N'tourism')
    INSERT dbo.Spheres(Code,Name) VALUES (N'tourism',N'Զբոսաշրջություն');

-- ForumCategories (7 source records)
UPDATE dbo.ForumCategories SET Name=N'Շինարարություն և ճարտարապետություն' WHERE Code=N'civil';
IF NOT EXISTS (SELECT 1 FROM dbo.ForumCategories WHERE Code=N'civil')
    INSERT dbo.ForumCategories(Code,Name) VALUES (N'civil',N'Շինարարություն և ճարտարապետություն');
UPDATE dbo.ForumCategories SET Name=N'Էլեկտրոնիկա և հեռահաղորդակցություն' WHERE Code=N'electronics';
IF NOT EXISTS (SELECT 1 FROM dbo.ForumCategories WHERE Code=N'electronics')
    INSERT dbo.ForumCategories(Code,Name) VALUES (N'electronics',N'Էլեկտրոնիկա և հեռահաղորդակցություն');
UPDATE dbo.ForumCategories SET Name=N'Էներգետիկա և կայուն զարգացում' WHERE Code=N'energy';
IF NOT EXISTS (SELECT 1 FROM dbo.ForumCategories WHERE Code=N'energy')
    INSERT dbo.ForumCategories(Code,Name) VALUES (N'energy',N'Էներգետիկա և կայուն զարգացում');
UPDATE dbo.ForumCategories SET Name=N'Ինֆորմատիկա և ծրագրավորում' WHERE Code=N'informatics';
IF NOT EXISTS (SELECT 1 FROM dbo.ForumCategories WHERE Code=N'informatics')
    INSERT dbo.ForumCategories(Code,Name) VALUES (N'informatics',N'Ինֆորմատիկա և ծրագրավորում');
UPDATE dbo.ForumCategories SET Name=N'Ընդհանուր թեմաներ (հին ֆորում)' WHERE Code=N'legacy-general';
IF NOT EXISTS (SELECT 1 FROM dbo.ForumCategories WHERE Code=N'legacy-general')
    INSERT dbo.ForumCategories(Code,Name) VALUES (N'legacy-general',N'Ընդհանուր թեմաներ (հին ֆորում)');
UPDATE dbo.ForumCategories SET Name=N'Տեխնիկական կառավարում և տնտեսագիտություն' WHERE Code=N'management';
IF NOT EXISTS (SELECT 1 FROM dbo.ForumCategories WHERE Code=N'management')
    INSERT dbo.ForumCategories(Code,Name) VALUES (N'management',N'Տեխնիկական կառավարում և տնտեսագիտություն');
UPDATE dbo.ForumCategories SET Name=N'Մեքենաշինություն և ռոբոտաշինություն' WHERE Code=N'mechanics';
IF NOT EXISTS (SELECT 1 FROM dbo.ForumCategories WHERE Code=N'mechanics')
    INSERT dbo.ForumCategories(Code,Name) VALUES (N'mechanics',N'Մեքենաշինություն և ռոբոտաշինություն');

-- Additional selector values required by the unchanged synthetic identities.
INSERT dbo.Specializations(Name,IsVerified) VALUES (N'Համակարգչային գիտություն',1);
INSERT dbo.Departments(Name) VALUES (N'Ծրագրային համակարգերի ամբիոն'), (N'Համակարգչային տեխնիկայի ամբիոն');

INSERT dbo.AlumniRegistry(FirstName,LastName,DiplomaNumber,StudyStartDate,StudyEndDate,SpecializationId)
SELECT N'Անի',N'Հակոբյան',N'TEST-ALUMNI-001','2018-09-01','2022-06-30',SpecializationId FROM dbo.Specializations WHERE Name=N'Ծրագրային ճարտարագիտություն';
INSERT dbo.AlumniRegistry(FirstName,LastName,DiplomaNumber,StudyStartDate,StudyEndDate,SpecializationId)
SELECT N'Արամ',N'Սարգսյան',N'TEST-ALUMNI-002','2019-09-01','2023-06-30',SpecializationId FROM dbo.Specializations WHERE Name=N'Համակարգչային գիտություն';
INSERT dbo.LecturerRegistry(FirstName,LastName,Email,DepartmentId)
SELECT N'Մարի',N'Մկրտչյան',N'test-lecturer-001@polytechnic.am',DepartmentId FROM dbo.Departments WHERE Name=N'Ծրագրային համակարգերի ամբիոն';
INSERT dbo.LecturerRegistry(FirstName,LastName,Email,DepartmentId)
SELECT N'Հայկ',N'Պետրոսյան',N'test-lecturer-002@polytechnic.am',DepartmentId FROM dbo.Departments WHERE Name=N'Համակարգչային տեխնիկայի ամբիոն';
