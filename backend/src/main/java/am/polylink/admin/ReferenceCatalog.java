package am.polylink.admin;

import java.util.*;

/** All SQL identifiers and dependency paths are server owned. See docs/admin_references.md. */
final class ReferenceCatalog {
    record Dependency(String table, String column) {}

    record Resource(
            String key,
            String table,
            String id,
            int nameLimit,
            int codeLimit,
            List<Dependency> dependencies) {
        boolean coded() {
            return codeLimit > 0;
        }
    }

    static final List<Resource> ALL =
            List.of(
                    resource(
                            "universities",
                            "Universities",
                            "UniversityId",
                            255,
                            0,
                            "dbo.Education:UniversityId"),
                    resource(
                            "institutes",
                            "Institutes",
                            "InstituteId",
                            255,
                            0,
                            "dbo.Education:InstituteId",
                            "auth.PendingEnrollments:InstituteId"),
                    resource(
                            "departments",
                            "Departments",
                            "DepartmentId",
                            255,
                            0,
                            "dbo.Lecturers:DepartmentId",
                            "dbo.LecturerRegistry:DepartmentId",
                            "auth.PendingEnrollments:DepartmentId"),
                    resource(
                            "specializations",
                            "Specializations",
                            "SpecializationId",
                            255,
                            0,
                            "dbo.Education:SpecializationId",
                            "dbo.AlumniRegistry:SpecializationId",
                            "auth.PendingEnrollments:SpecializationId"),
                    resource(
                            "professions",
                            "Professions",
                            "ProfessionId",
                            150,
                            0,
                            "dbo.Lecturers:ProfessionId",
                            "auth.PendingEnrollments:ProfessionId"),
                    resource("degrees", "Degrees", "DegreeId", 100, 0, "dbo.Education:DegreeId"),
                    resource(
                            "post-types",
                            "PostTypes",
                            "PostTypeId",
                            100,
                            16,
                            "dbo.Posts:PostTypeId"),
                    resource("post-spheres", "Spheres", "SphereId", 150, 32, "dbo.Posts:SphereId"),
                    resource(
                            "forum-categories",
                            "ForumCategories",
                            "CategoryId",
                            255,
                            32,
                            "dbo.ForumTopics:CategoryId"));

    static Resource require(String key) {
        return ALL.stream()
                .filter(r -> r.key().equals(key))
                .findFirst()
                .orElseThrow(AdminFailure::missing);
    }

    private static Resource resource(
            String key, String table, String id, int nameLimit, int codeLimit, String... paths) {
        return new Resource(
                key,
                table,
                id,
                nameLimit,
                codeLimit,
                Arrays.stream(paths)
                        .map(path -> path.split(":"))
                        .map(path -> new Dependency(path[0], path[1]))
                        .toList());
    }

    private ReferenceCatalog() {}
}
