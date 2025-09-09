-- Convert Divs marked as 'part' (either class .part or id 'part')
-- into LaTeX commands based on explicit nesting we compute.
-- Depth 1: \question, 2: \part, 3: \subpart, 4+: \subsubpart

-- Determine the LaTeX command for the given depth
local function command_for_depth(d)
  if d <= 1 then return '\\question' end
  if d == 2 then return '\\part' end
  if d == 3 then return '\\subpart' end
  return '\\subsubpart'
end

-- Identify a 'part' Div: either class .part or id 'part'
local function is_part_div(block)
  if block.t ~= 'Div' then return false end
  local has_class = block.classes and block.classes:includes('part')
  local has_id = block.identifier and block.identifier == 'part'
  return has_class or has_id
end

-- Map child depth to environment name
local function env_for_child_depth(d)
  if d == 2 then return 'parts' end
  if d == 3 then return 'subparts' end
  if d >= 4 then return 'subsubparts' end
  return nil
end

-- Transform blocks recursively, carrying explicit depth
local function transform_blocks(blocks, current_depth)
  local output = pandoc.List:new()

  local i = 1
  while i <= #blocks do
    local b = blocks[i]
    if is_part_div(b) then
      local new_depth = current_depth + 1
      local title = b.attributes and b.attributes.title
      local points = nil
      if b.attributes then
        points = b.attributes.points or b.attributes.point or b.attributes.pts or b.attributes.p
      end
      local bracket = ''
      if points and points ~= '' then
        bracket = '[' .. points .. ']'
      end
      local cmdline
      if new_depth == 1 then
        if title and title ~= '' then
          cmdline = '\\titledquestion' .. bracket .. '{' .. title .. '}'
        else
          cmdline = '\\question' .. bracket
        end
      else
        if title and title ~= '' then
          cmdline = '\\part' .. bracket .. ' ' .. title
        else
          cmdline = command_for_depth(new_depth) .. bracket
        end
      end
      output:insert(pandoc.RawBlock('tex', cmdline))

      -- Scan direct child blocks; group consecutive child parts into env
      local child_blocks = b.content or pandoc.List:new()
      local j = 1
      while j <= #child_blocks do
        local cb = child_blocks[j]
        if is_part_div(cb) then
          local k = j
          while k <= #child_blocks and is_part_div(child_blocks[k]) do
            k = k + 1
          end
          local env = env_for_child_depth(new_depth + 1)
          if env then
            output:insert(pandoc.RawBlock('tex', '\\begin{' .. env .. '}'))
          end
          for x = j, k - 1 do
            local transformed = transform_blocks({ child_blocks[x] }, new_depth)
            for y = 1, #transformed do
              output:insert(transformed[y])
            end
          end
          if env then
            output:insert(pandoc.RawBlock('tex', '\\end{' .. env .. '}'))
          end
          j = k
        else
          local transformed = transform_blocks({ cb }, new_depth)
          for y = 1, #transformed do
            output:insert(transformed[y])
          end
          j = j + 1
        end
      end
    else
      -- Non-part blocks: recurse to catch nested parts further down
      if b.t == 'Div' then
        -- Reconstruct Div with transformed children
        local transformed_children = transform_blocks(b.content or pandoc.List:new(), current_depth)
        local new_div = pandoc.Div(transformed_children, b.attr)
        output:insert(new_div)
      else
        output:insert(b)
      end
    end
    i = i + 1
  end

  return output
end

function Pandoc(doc)
  doc.blocks = transform_blocks(doc.blocks, 0)
  return doc
end
