package am.polylink.admin;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@AdminEnabled
@RequestMapping("/admin/references/{kind}")
public class AdminReferencesController {
    private final AdminReferences references;

    public AdminReferencesController(AdminReferences references) {
        this.references = references;
    }

    @GetMapping
    public Object list(
            @PathVariable String kind,
            @RequestParam(defaultValue = "") String q,
            @RequestParam(required = false) String cursor,
            HttpServletRequest request) {
        return references.list(kind, q, cursor, request);
    }

    @GetMapping("/{id}")
    public Object detail(
            @PathVariable String kind, @PathVariable int id, HttpServletRequest request) {
        return references.detail(kind, id, request);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Object create(
            @PathVariable String kind,
            @RequestBody Map<String, Object> input,
            HttpServletRequest request) {
        return references.create(kind, input, request);
    }

    @PutMapping("/{id}")
    public Object update(
            @PathVariable String kind,
            @PathVariable int id,
            @RequestBody Map<String, Object> input,
            HttpServletRequest request) {
        return references.update(kind, id, input, request);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(
            @PathVariable String kind,
            @PathVariable int id,
            @RequestBody Map<String, Object> input,
            HttpServletRequest request) {
        references.delete(kind, id, input, request);
    }
}
