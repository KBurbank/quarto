---
format:

    examclass-pdf+solutions:
        filters:
          - "../part-filter.lua"
          - "_extensions/kburbank/examclass/add_questions_environment.lua"
        keep-tex: true
        latex-auto-install: false
        header-includes:
          - |
              % alias examsolution to exam's solution (with optional [space])
              \newenvironment{examsolution}[1][]{\begin{solution}[#1]}{\end{solution}}
    html:
        css: [part.css]
    md:
      pandoc:
        to: markdown+raw_tex
      filters: ["../part-filter.lua"]
---






Some text here.

:::::: {.part title="The title of the first question"}
oh this is pretty awesome now

::: {.examsolution space=".5in"}
This is another solution





::: {.cell}

```{.r .cell-code}
4+5
```

::: {.cell-output .cell-output-stdout}

```
[1] 9
```


:::
:::




:::

::: {.part points="2"}
Some text here...
:::

::: {.part title="This is a great title!" points="5"}
The second part.

Suppose we have $e=mc^2$.
:::
::::::