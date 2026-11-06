package am.polylink.admin;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@AdminEnabled
@RequestMapping("/admin/registries/{kind}")
public class AdminRegistriesController {
    private final AdminRegistries registries;

    public AdminRegistriesController(AdminRegistries registries) {
        this.registries = registries;
    }

    @GetMapping
    public Object list(
            @PathVariable String kind,
            @RequestParam(defaultValue = "") String q,
            @RequestParam(required = false) String cursor,
            HttpServletRequest request) {
        return registries.list(kind, q, cursor, request);
    }

    @GetMapping("/{id}")
    public Object detail(
            @PathVariable String kind, @PathVariable int id, HttpServletRequest request) {
        return registries.detail(kind, id, request);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Object create(
            @PathVariable String kind,
            @RequestBody Map<String, Object> input,
            HttpServletRequest request) {
        return registries.create(kind, input, request);
    }

    @PutMapping("/{id}")
    public Object update(
            @PathVariable String kind,
            @PathVariable int id,
            @RequestBody Map<String, Object> input,
            HttpServletRequest request) {
        return registries.update(kind, id, input, request);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(
            @PathVariable String kind,
            @PathVariable int id,
            @RequestBody Map<String, Object> input,
            HttpServletRequest request) {
        registries.delete(kind, id, input, request);
    }
}
