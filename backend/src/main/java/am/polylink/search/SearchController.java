package am.polylink.search;

import am.polylink.auth.*;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

@RestController
@IdentityEnabled
public class SearchController {
    private final Sessions sessions;
    private final SearchService search;

    public SearchController(Sessions sessions, SearchService search) {
        this.sessions = sessions;
        this.search = search;
    }

    @GetMapping("/search/people")
    public Object page(
            @RequestParam(defaultValue = "") String q,
            @RequestParam(required = false) Integer specializationId,
            @RequestParam(required = false) Integer instituteId,
            @RequestParam(required = false) Integer year,
            @RequestParam(defaultValue = "50") int limit,
            @RequestParam(required = false) String cursor,
            HttpServletRequest request) {
        int caller = sessions.require(request).account().id();
        return search.page(
                caller,
                new SearchService.Filters(q, specializationId, instituteId, year, limit),
                cursor);
    }

    @GetMapping("/search/filters")
    public Object filters(HttpServletRequest request) {
        sessions.require(request);
        return search.filters();
    }

    @GetMapping("/search")
    public Object people(@RequestParam(defaultValue = "") String q, HttpServletRequest request) {
        return search.page(
                        sessions.require(request).account().id(),
                        new SearchService.Filters(q, null, null, null, 100),
                        null)
                .get("items");
    }
}
