package am.polylink.profile;

import am.polylink.auth.AuthFailure;
import java.time.*;
import java.util.*;

/** Shared strict input and precision rules. Dates are calendar periods, never instants. */
public final class ProfileValues {
    private ProfileValues() {}

    public static void fields(Map<String, Object> input, String... fields) {
        if (!Set.of(fields).containsAll(input.keySet())) throw AuthFailure.invalid();
    }

    public static String text(Object value, int max, boolean required) {
        if (value != null && !(value instanceof String)) throw AuthFailure.invalid();
        String s = Objects.toString(value, "").strip();
        if ((required && s.isEmpty())
                || s.length() > max
                || s.codePoints()
                        .anyMatch(
                                c ->
                                        Character.isISOControl(c)
                                                && c != '\n'
                                                && c != '\r'
                                                && c != '\t')) throw AuthFailure.invalid();
        return s;
    }

    public static Integer id(Object value, boolean required) {
        if (value == null || "".equals(value)) {
            if (required) throw AuthFailure.invalid();
            return null;
        }
        if (!(value instanceof String || value instanceof Number)
                || !value.toString().matches("[1-9][0-9]{0,9}")) throw AuthFailure.invalid();
        try {
            return Integer.valueOf(value.toString());
        } catch (NumberFormatException e) {
            throw AuthFailure.invalid();
        }
    }

    public record Period(LocalDate date, String precision) {
        public LocalDate latest() {
            return date == null
                    ? null
                    : switch (precision) {
                        case "YEAR" -> date.withMonth(12).withDayOfMonth(31);
                        case "MONTH" -> date.withDayOfMonth(date.lengthOfMonth());
                        default -> date;
                    };
        }

        public String value() {
            return date == null
                    ? null
                    : switch (precision) {
                        case "YEAR" -> date.toString().substring(0, 4);
                        case "MONTH" -> date.toString().substring(0, 7);
                        default -> date.toString();
                    };
        }
    }

    public static Period period(Object value, boolean allowDay) {
        String s = text(value, 10, false);
        if (s.isEmpty()) return new Period(null, null);
        try {
            String precision =
                    s.matches("[0-9]{4}")
                            ? "YEAR"
                            : s.matches("[0-9]{4}-[0-9]{2}")
                                    ? "MONTH"
                                    : allowDay && s.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")
                                            ? "DAY"
                                            : "";
            LocalDate date =
                    switch (precision) {
                        case "YEAR" -> LocalDate.of(Integer.parseInt(s), 1, 1);
                        case "MONTH" -> YearMonth.parse(s).atDay(1);
                        case "DAY" -> LocalDate.parse(s);
                        default -> throw AuthFailure.invalid();
                    };
            if (date.getYear() < 1900 || date.getYear() > 2200) throw AuthFailure.invalid();
            return new Period(date, precision);
        } catch (DateTimeException | NumberFormatException e) {
            throw AuthFailure.invalid();
        }
    }

    public static void range(Period start, Period end, boolean ongoing) {
        if ((ongoing && end.date() != null)
                || (start.date() != null
                        && end.date() != null
                        && end.latest().isBefore(start.date()))) throw AuthFailure.invalid();
    }

    public static String url(Object value) {
        String s = text(value, 2048, false);
        if (!s.isEmpty())
            try {
                var u = new java.net.URI(s);
                if (!Set.of("http", "https")
                                .contains(
                                        Objects.toString(u.getScheme(), "")
                                                .toLowerCase(Locale.ROOT))
                        || u.getHost() == null
                        || u.getRawUserInfo() != null) throw AuthFailure.invalid();
            } catch (java.net.URISyntaxException e) {
                throw AuthFailure.invalid();
            }
        return s;
    }
}
