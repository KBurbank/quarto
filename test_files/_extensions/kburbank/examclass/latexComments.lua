-- This file is used to find lines in a Markdown document which begin with a percent sign (%), and mark these lines as inline LaTeX so that Pandoc will process them as LaTeX comments.

function Para(el)
    return pandoc.Para(findLatexComments(el))
end

function Plain(el)
    return pandoc.Plain(findLatexComments(el))
end

function Math(el)
   -- Check if el is valid and has text property
   if el and el.text then
    if el.text:match("^%s%%") then
        return(pandoc.RawInline("tex", el.text))
    else
      return el
   end
end
end

function findLatexComments(block)
    local to_return = {}
    local in_comment = false
    local current_comment = {}
    
    local function flush_comment()
        if #current_comment > 0 then
            table.insert(to_return, pandoc.RawInline("tex", table.concat(current_comment)))
            current_comment = {}
        end
    end
    
    for _, el in ipairs(block.content) do
        if el.t == "Str" and el.text:match("^%%") then
            in_comment = true
        end
        
        if in_comment then
            if el.text then
                table.insert(current_comment, el.text)
            elseif el.t == "Space" then
                table.insert(current_comment, " ")
            elseif el.t == "SoftBreak" then
                in_comment = false
                table.insert(current_comment, "\n")
                flush_comment()
            end
        else
           flush_comment()
            table.insert(to_return, el)
        end
    end
    
    -- Flush any remaining comment at the end
    flush_comment()
    
    return to_return
end
