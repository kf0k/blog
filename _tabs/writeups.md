---
title: Writeups
icon: fas fa-flag
order: 2
---

HTB machines, every one solved and documented. Filter by category or
tag in the sidebar.

<ul class="post-list">
{% assign writeups = site.categories["writeups"] | default: site.posts %}
{% for post in writeups %}
  {% if post.categories contains "writeups" %}
  <li>
    <a href="{{ post.url | relative_url }}"><strong>{{ post.title }}</strong></a>
    {% if post.difficulty %}<span class="badge">{{ post.difficulty }}</span>{% endif %}
    {% if post.os %}<span class="badge">{{ post.os }}</span>{% endif %}
    <br><small>{{ post.description }}</small>
  </li>
  {% endif %}
{% endfor %}
</ul>
