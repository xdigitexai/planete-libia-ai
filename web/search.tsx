import { useState } from "react";
import { Link } from "react-router-dom";
import { useData, Status, Avatar, Pager } from "./lib";
export function GlobalSearch() {
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(1);
  const q = encodeURIComponent(query);
  const people = useData(`/users?q=${q}&page=${page}`),
    news = useData(`/news?q=${q}&page=${page}`);
  return (
    <>
      <h1>Rechercher</h1>
      <label>
        Personnes et actualités
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          placeholder="Un nom, un sujet, une idée…"
        />
      </label>
      <h2>La communauté</h2>
      <Status {...people} />
      {people.data?.map((u: any) => (
        <Link className="list-row" key={u.id} to={`/profil/${u.id}`}>
          <Avatar user={u} />
          <span>
            {u.name}
            <small>@{u.username}</small>
          </span>
        </Link>
      ))}
      <h2>Actualités</h2>
      <Status {...news} />
      {news.data?.map((a: any) => (
        <Link className="list-row" key={a.id} to={`/actualites/${a.id}`}>
          <span>
            {a.title}
            <small>{a.summary}</small>
          </span>
        </Link>
      ))}
      <Pager
        page={page}
        setPage={setPage}
        count={Math.max(people.data?.length || 0, news.data?.length || 0)}
      />
    </>
  );
}
