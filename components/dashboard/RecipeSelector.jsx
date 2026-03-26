'use client'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { BookOpen, ChevronDown, Rocket, Layout, Palette, Bug, Wrench, Gamepad2, Image } from 'lucide-react'

const RECIPES = [
  { id: 'saas_landing', name: 'SaaS Landing Page', icon: Rocket, description: 'Hero, features, pricing, CTA' },
  { id: 'dashboard', name: 'Dashboard', icon: Layout, description: 'Stats, charts, tables, sidebar' },
  { id: 'react_components', name: 'React Component Set', icon: Palette, description: 'Reusable UI component library' },
  { id: 'sprite_sheet', name: 'Sprite Sheet', icon: Gamepad2, description: 'Frame-based sprite sheet generator' },
  { id: 'refactor', name: 'Refactor Mode', icon: Wrench, description: 'Break down into reusable components' },
  { id: 'bugfix', name: 'Bug-Fix Mode', icon: Bug, description: 'Diagnose and fix issues in code' },
  { id: 'sprite_asset', name: 'Game Asset Builder', icon: Image, description: 'Transparent PNG character assets' },
]

const RECIPE_PROMPTS = {
  saas_landing: 'Create a SaaS landing page with: hero section with headline and CTA, features grid (3-4 features), pricing table (3 tiers), testimonials, and footer. Use modern design with Tailwind CSS.',
  dashboard: 'Create an admin dashboard with: sidebar navigation, stats cards (4 metrics), a data table with sorting, a line chart area, and a recent activity feed. Use React and Tailwind CSS.',
  react_components: 'Create a reusable React component library with: Button (variants: primary, secondary, outline, ghost), Card, Input, Modal, Badge, and Alert components. Use Tailwind CSS and include TypeScript types.',
  sprite_sheet: 'Plan a sprite sheet for a 2D game character. Include: idle animation (4 frames), walk cycle (6 frames), jump (3 frames), attack (4 frames). Define canvas size 512x512, frame size 64x64, transparent background.',
  refactor: 'Analyze the current project files and refactor them into smaller, reusable components. Identify repeated patterns, extract shared utilities, and create a clean file structure.',
  bugfix: 'Review the current project files for potential bugs, anti-patterns, and issues. Provide specific fixes with code changes for each issue found.',
  sprite_asset: 'Create a structured sprite generation plan: define character name, states (idle, walk, run, jump, attack, hurt, death), frame count per state, canvas constraints (transparent background, no bleed, safe margins), and naming conventions.',
}

export default function RecipeSelector({ onSelectRecipe }) {
  const handleSelect = (recipe) => {
    const prompt = RECIPE_PROMPTS[recipe.id]
    if (prompt) onSelectRecipe(prompt, recipe.name)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2.5 text-xs" data-testid="recipe-selector">
          <BookOpen className="w-3 h-3" />
          Recipes
          <ChevronDown className="w-3 h-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {RECIPES.map((recipe) => {
          const Icon = recipe.icon
          return (
            <DropdownMenuItem
              key={recipe.id}
              className="cursor-pointer"
              onClick={() => handleSelect(recipe)}
              data-testid={`recipe-${recipe.id}`}
            >
              <div className="flex items-start gap-3">
                <Icon className="w-4 h-4 mt-0.5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{recipe.name}</p>
                  <p className="text-xs text-muted-foreground">{recipe.description}</p>
                </div>
              </div>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { RECIPES, RECIPE_PROMPTS }
