// Матчеры вида toBeDisabled/toHaveTextContent. Регистрация безвредна и для node-тестов:
// jest-dom только расширяет expect и к DOM не обращается, пока матчер не вызван.
import "@testing-library/jest-dom/vitest";
