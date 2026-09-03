import { NavLink } from "react-router-dom";
import {
  Home,
  MessageCircle,
  Sparkles,
  Newspaper,
  UserRound,
} from "lucide-react";
export function PublicNav() {
  return (
    <nav className="bottom-nav">
      {[
        ["/accueil", Home, "Accueil"],
        ["/discussions", MessageCircle, "Discussions"],
        ["/ia", Sparkles, "IA"],
        ["/actualites", Newspaper, "Actualités"],
        ["/profil", UserRound, "Profil"],
      ].map(([to, Icon, label]: any) => (
        <NavLink key={to} to={to}>
          <Icon size={20} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
