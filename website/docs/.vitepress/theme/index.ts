import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import AlphaBadge from "./AlphaBadge.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      "nav-bar-title-after": () => h(AlphaBadge),
    });
  },
};
